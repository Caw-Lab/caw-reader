// SPDX-License-Identifier: MIT
//
// Decoding of action bytes (packedActions) and extracting them from transaction calldata.
// Sources: only the spec memo section "Action format" and solidity/contracts/ (MIT) in GilgameshCaw/Caw.
// How one action is read was carried over unchanged from decodePacked in the read-only viewer prototype v0.

import { keccak256 } from 'ethers';

export const ACTION_TYPES = ['CAW', 'LIKE', 'UNLIKE', 'RECAW', 'FOLLOW', 'UNFOLLOW', 'WITHDRAW', 'OTHER'];

// Reads count actions starting at pos. All values are big-endian (CawActions.sol:1766-1831).
// Each returned action carries its start/end position in the original bytes.
export function decodeActionsAt(bytes, pos, count) {
  let p = pos;
  const need = (n) => { if (p + n > bytes.length) throw new Error('Action bytes are truncated (position ' + p + ')'); };
  const uint = (n) => { need(n); let v = 0; for (let i = 0; i < n; i++) v = v * 256 + bytes[p + i]; p += n; return v; };
  const uintBig = (n) => { need(n); let v = 0n; for (let i = 0; i < n; i++) v = (v << 8n) | BigInt(bytes[p + i]); p += n; return v; };

  const actions = [];
  for (let i = 0; i < count; i++) {
    const start = p;
    const type = uint(1);
    const senderId = uint(4);
    const receiverId = uint(4);
    const receiverCawonce = uint(4);
    const networkId = uint(4);
    const cawonce = uint(4);
    const nR = uint(1);
    const nA = uint(1);
    const recipients = [];
    for (let j = 0; j < nR; j++) recipients.push(uint(4));
    const amounts = [];
    for (let j = 0; j < nA; j++) amounts.push(uintBig(8));
    const tl = uint(2);
    need(tl);
    const text = bytes.slice(p, p + tl);
    p += tl;
    actions.push({
      type, typeName: ACTION_TYPES[type] ?? ('UNKNOWN_' + type),
      senderId, receiverId, receiverCawonce, networkId, cawonce,
      recipients, amounts, text, start, end: p,
      raw: bytes.subarray(start, p),   // the bytes of this action itself (for comparison)
    });
  }
  return { actions, end: p };
}

// packedActions of CawActions: a uint16 actionCount, then the actions (CawActions.sol:330).
export function decodePacked(bytes) {
  if (bytes.length < 2) throw new Error('packedActions is too short');
  const count = bytes[0] * 256 + bytes[1];
  const { actions, end } = decodeActionsAt(bytes, 2, count);
  return { count, actions, trailing: bytes.length - end };
}

// packedActions of CawActionsERC1271: repeated [uint16 groupSize][action x groupSize]
// (CawActionsERC1271.sol:131-134). The batchHash of each group is the keccak of the action part,
// without groupSize (same file :193-195). Returns null if the shape does not fit.
export function decodeErc1271Groups(bytes) {
  const groups = [];
  let p = 0;
  try {
    while (p < bytes.length) {
      if (p + 2 > bytes.length) return null;
      const size = bytes[p] * 256 + bytes[p + 1];
      if (size === 0) return null;
      const start = p + 2;
      const { actions, end } = decodeActionsAt(bytes, start, size);
      groups.push({ size, start, end, actions });
      p = end;
    }
  } catch {
    return null;
  }
  return groups.length ? groups : null;
}

// Upper bound on the size of packedActions in one submission.
// At most 256 actions (CawActions.sol:331-332); one action is at most 1+4x5+1+1+4x10+8x11+2+420 = 573 bytes
// (recipients <= 10 :1672, amounts <= 11 :1674-1676, text <= 420 bytes :1300).
// 256 x 573 + 2 = 146,690. Some margin is added for the ERC1271 group headers (2 bytes x up to 256).
export const MAX_PACKED_BYTES = 150000;

// Upper bound on the bytes hashed or decoded while searching one transaction.
// Guards against crafted, huge calldata meant to inflate the hashing work.
export const SEARCH_BUDGET_BYTES = 16 * 1024 * 1024;

// Yields every ABI bytes value in the calldata, i.e. "a 32-byte length word + the body".
// ABI-encoded bytes appear in this shape whether the call is direct or nested through another
// contract (a wallet or a relay).
// The caller decides which one is real by batchHash (keccak). Because matching is by hash,
// other bytes that merely look similar are never taken by mistake.
export function* abiBytesCandidates(data) {
  const n = data.length;
  for (let o = 0; o + 32 <= n; o++) {
    // Only look at words whose first 29 bytes are 0, so the length is below 2^24
    let zero = true;
    for (let k = 0; k < 29; k++) { if (data[o + k] !== 0) { zero = false; break; } }
    if (!zero) continue;
    const len = data[o + 29] * 65536 + data[o + 30] * 256 + data[o + 31];
    if (len < 2 || len > MAX_PACKED_BYTES || o + 32 + len > n) continue;
    yield data.subarray(o + 32, o + 32 + len);
  }
}

// Return value: { found, exhausted }. found is what was found (null if nothing);
// exhausted tells whether the search hit its limit and stopped early.

// Finds the packedActions for an ActionsProcessed / ActionsProcessedZk of CawActions (normal, safe, ZK).
// Condition: the count in the first 2 bytes equals actionCount, and keccak256 equals batchHash.
export function findPackedForBatch(calldata, batchHash, actionCount, budget = SEARCH_BUDGET_BYTES) {
  const want = batchHash.toLowerCase();
  for (const c of abiBytesCandidates(calldata)) {
    if (c[0] * 256 + c[1] !== actionCount) continue;
    budget -= c.length;
    if (budget < 0) return { found: null, exhausted: true };
    if (keccak256(c) === want) return { found: Uint8Array.from(c), exhausted: false };
  }
  return { found: null, exhausted: false };
}

// Finds the group for an ActionsProcessed of CawActionsERC1271.
// Condition: the group size equals actionCount, and keccak256 of the action part equals batchHash.
export function findErc1271Group(calldata, batchHash, actionCount, budget = SEARCH_BUDGET_BYTES) {
  const want = batchHash.toLowerCase();
  for (const c of abiBytesCandidates(calldata)) {
    // If the first group size is 0, it is not this shape (a cheap rejection)
    if (c[0] * 256 + c[1] === 0) continue;
    budget -= c.length;
    if (budget < 0) return { found: null, exhausted: true };
    const groups = decodeErc1271Groups(c);
    if (!groups) continue;
    for (const g of groups) {
      if (g.size !== actionCount) continue;
      budget -= g.end - g.start;
      if (budget < 0) return { found: null, exhausted: true };
      if (keccak256(c.subarray(g.start, g.end)) === want) {
        const bytes = Uint8Array.from(c.subarray(g.start, g.end));
        return { found: { bytes, actions: decodeActionsAt(bytes, 0, g.size).actions }, exhausted: false };
      }
    }
  }
  return { found: null, exhausted: false };
}

// SPDX-License-Identifier: MIT
//
// archive-check: re-derives, from the calldata of one CawActionsArchive submission, what the contract's
// slashIncoherentRoot derives, and compares the result with the archive's stored values, with the
// checkpoint hashes on the chain CawActions runs on, and with the actions this reader has stored.
// Read calls only; no writes, no signing, no keys.
//
// The pure functions at the top need no network. The source (what is read from the two chains) is passed in,
// so that the checks can be run on fixed data.

import { AbiCoder, Contract, Interface, JsonRpcProvider, concat, getBytes, hexlify, id as topicId, keccak256, solidityPacked, toBeHex, zeroPadValue } from 'ethers';
import { decodeActionsAt } from './decode.mjs';

export const ZERO_HASH = '0x' + '00'.repeat(32);
export const STATUS_NAMES = ['PENDING', 'FINALIZED', 'SLASHED'];
export const CHECKPOINT_SIZE = 32;

// ---- pure functions ----

// dataCommitment = keccak256(packedHash || rHash || entryHash), with rHash = keccak256(abi.encodePacked(r))
export function commitmentOf(packed, r, entryHash) {
  const rHash = keccak256(solidityPacked(['bytes32[]'], [r]));
  return keccak256(concat([keccak256(packed), rHash, entryHash]));
}

// The end of the action that starts at pos (CawActionsArchive._actionSliceEnd):
// 21 fixed bytes, the recipient and amount counts (1 byte each), 4 bytes per recipient, 8 per amount,
// a uint16 text length and the text. Returns -1 when the bytes are too short.
export function sliceEnd(buf, pos) {
  if (pos + 23 > buf.length) return -1;
  const next = pos + 23 + buf[pos + 21] * 4 + buf[pos + 22] * 8;
  if (next + 2 > buf.length) return -1;
  const end = next + 2 + (buf[next] * 256 + buf[next + 1]);
  return end > buf.length ? -1 : end;
}

// Folds the hash chain over the actions: h = keccak256(h || r[i] || keccak256(slice)), and collects the hash at
// every 32nd action. packed is [uint16 count][action x count]. expected is the number of actions the submission
// says it covers. Never throws on bad bytes: it reports what it found.
export function foldChain(entryHash, packed, r, expected) {
  const buf = getBytes(packed);
  const out = { headerCount: buf.length >= 2 ? buf[0] * 256 + buf[1] : null, expected, rLength: r.length, cpHashes: [], actionHashes: [], consumed: 0, trailing: 0, truncatedAt: null };
  let h = entryHash;
  let pos = 2;
  for (let i = 0; i < expected; i++) {
    const end = sliceEnd(buf, pos);
    if (end < 0) { out.truncatedAt = i; break; }
    if (i >= r.length) { out.truncatedAt = i; break; }
    const sliceHash = keccak256(buf.subarray(pos, end));
    out.actionHashes.push(sliceHash);
    h = keccak256(concat([h, r[i], sliceHash]));
    pos = end;
    if ((i + 1) % CHECKPOINT_SIZE === 0) out.cpHashes.push(h);
  }
  out.consumed = out.actionHashes.length;
  out.trailing = buf.length - pos;
  return out;
}

// CawActionsArchive._buildMerkleRoot: leaf keccak256(keccak256(abi.encode(checkpointId, hash))), pairs sorted
// by value, and an odd last node carried up unchanged
export function merkleRootOf(startCp, cpHashes) {
  const coder = AbiCoder.defaultAbiCoder();
  let layer = cpHashes.map((h, i) => keccak256(keccak256(coder.encode(['uint256', 'bytes32'], [BigInt(startCp) + BigInt(i), h]))));
  if (!layer.length) return ZERO_HASH;
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 >= layer.length) { next.push(layer[i]); continue; }
      const a = layer[i], b = layer[i + 1];
      next.push(BigInt(a) < BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a])));
    }
    layer = next;
  }
  return layer[0];
}

// One check result: { name, ok: true | false | null, detail }. null means "not checked" (it is not a failure).
const check = (name, ok, detail = '') => ({ name, ok, detail });

// The checks that need only the submission itself.
// sub: { merkleRoot, startCheckpointId, endCheckpointId, dataCommitment } (as read from the contract)
// call: { packed, r, merkleRoot, entryHash } (the arguments of the submitReplication call)
export function checkSubmission(sub, call) {
  const start = Number(sub.startCheckpointId);
  const end = Number(sub.endCheckpointId);
  const expected = (end - start + 1) * CHECKPOINT_SIZE;
  const checks = [];
  checks.push(check('data commitment', commitmentOf(call.packed, call.r, call.entryHash) === sub.dataCommitment,
    'keccak256(packedHash, rHash, entryHash) equals the stored dataCommitment'));
  checks.push(check('merkle root argument', call.merkleRoot === sub.merkleRoot, 'the root in the call equals the stored merkleRoot'));
  const f = foldChain(call.entryHash, call.packed, call.r, expected);
  const shapeOk = f.truncatedAt === null && f.trailing === 0 && f.headerCount === expected && f.rLength === expected;
  checks.push(check('shape', shapeOk,
    shapeOk ? expected + ' actions, ' + expected + ' r values, no trailing bytes'
      : 'expected ' + expected + ' actions; header says ' + f.headerCount + ', r has ' + f.rLength + ', ' + f.consumed + ' read'
        + (f.truncatedAt !== null ? ', cut at action ' + f.truncatedAt : '') + ', ' + f.trailing + ' trailing byte(s)'));
  const root = merkleRootOf(start, f.cpHashes);
  checks.push(check('merkle root rebuilt', shapeOk && root === sub.merkleRoot, 'the root rebuilt from the chain equals the stored merkleRoot'));
  return { checks, fold: f, start, end, expected };
}

// Fields of an action as the archive carries them versus a row of the actions table
export function sameAction(a, row) {
  const diffs = [];
  const f = (name, x, y) => { if (String(x) !== String(y)) diffs.push(name); };
  f('type', a.type, row.type);
  f('sender_id', a.senderId, row.sender_id);
  f('receiver_id', a.receiverId, row.receiver_id);
  f('receiver_cawonce', a.receiverCawonce, row.receiver_cawonce);
  f('network_id', a.networkId, row.network_id);
  f('cawonce', a.cawonce, row.cawonce);
  f('recipients', JSON.stringify(a.recipients), JSON.stringify(JSON.parse(row.recipients)));
  f('amounts', JSON.stringify(a.amounts.map(String)), JSON.stringify(JSON.parse(row.amounts).map(String)));
  if (hexlify(a.text) !== hexlify(row.text)) diffs.push('text');
  return diffs;
}

// Compares the actions of a submission with the actions this reader read from the chain.
// Matched by (sender_id, cawonce): unique among accepted rows (index actions_accepted_key).
// Rows marked ambiguous are reported on their own, not as mismatches.
export function compareWithDb(db, packed) {
  const buf = getBytes(packed);
  const count = buf[0] * 256 + buf[1];
  const { actions } = decodeActionsAt(buf, 2, count);
  const accepted = db.prepare("SELECT * FROM actions WHERE status = 'accepted' AND sender_id = ? AND cawonce = ?");
  const ambiguous = db.prepare("SELECT * FROM actions WHERE status = 'ambiguous' AND sender_id = ? AND cawonce = ?");
  const r = { total: actions.length, matched: 0, mismatched: [], notInDb: [], ambiguous: [] };
  for (const a of actions) {
    const key = a.senderId + ':' + a.cawonce;
    const row = accepted.get(a.senderId, a.cawonce);
    if (row) {
      const diffs = sameAction(a, row);
      if (diffs.length) r.mismatched.push({ key, fields: diffs }); else r.matched++;
      continue;
    }
    const amb = ambiguous.all(a.senderId, a.cawonce);
    if (amb.length) {
      // The archive holds only the action that was applied: show which candidate it equals
      const equal = amb.filter((x) => sameAction(a, x).length === 0).map((x) => x.seq);
      r.ambiguous.push({ key, candidates: amb.length, equal });
      continue;
    }
    r.notInDb.push(key);
  }
  return r;
}

// ---- reading from the chains ----

const ARCHIVE_ABI = [
  'function nextSubmissionId() view returns (uint256)',
  'function CHALLENGE_PERIOD() view returns (uint256)',
  'function submissions(uint256) view returns (address submitter, bytes32 merkleRoot, uint32 networkId, uint64 startCheckpointId, uint64 endCheckpointId, uint64 finalizedAt, uint8 status, bytes32 dataCommitment)',
  'event SubmissionCreated(uint256 indexed submissionId, address indexed submitter, uint32 indexed networkId, uint256 startCheckpointId, uint256 endCheckpointId, bytes32 merkleRoot)',
  'function submitReplication(uint32 networkId, uint256 startCheckpointId, uint256 endCheckpointId, bytes packedActions, bytes32[] r, bytes32 merkleRoot, bytes32 entryHash)',
];
const iface = new Interface(ARCHIVE_ABI);
const SUBMISSION_CREATED = topicId('SubmissionCreated(uint256,address,uint32,uint256,uint256,bytes32)');
const CALL_TIMEOUT_MS = 30000;
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Replaces every URL in a text by its origin: RPC URLs often carry an API key in the path or the query,
// and error messages of the RPC library can contain the full URL
export function redactUrls(text) {
  return String(text).replace(/https?:\/\/[^\s"'<>),]+/g, (u) => { try { return new URL(u).origin + '/****'; } catch { return '(url)'; } });
}

// Errors worth another try: rate limits, timeouts and dropped connections. A reverted call or bad data is not retried.
export function isTransient(e) {
  const s = [e?.shortMessage, e?.message, e?.code, e?.info?.responseStatus, e?.info?.error?.code].filter((x) => x != null).join(' ');
  return /\b429\b|rate.?limit|too many requests|No response from RPC|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|SERVER_ERROR|NETWORK_ERROR|\b50[234]\b/i.test(s);
}

export async function withRetry(fn, { tries = 4, baseMs = 1000, sleepFn = sleep } = {}) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= tries || !isTransient(e)) throw e;
      await sleepFn(baseMs * 2 ** (i - 1));
    }
  }
}

function withTimeout(fn, what) {
  return withRetry(() => {
    let t;
    const timeout = new Promise((_, reject) => { t = setTimeout(() => reject(new Error('No response from RPC (' + what + ', ' + CALL_TIMEOUT_MS / 1000 + ' s)')), CALL_TIMEOUT_MS); });
    return Promise.race([fn(), timeout]).finally(() => clearTimeout(t));
  });
}

// The source used by the command: the archive chain (cfg.cawArchive) and the chain CawActions runs on (cfg.rpcUrl).
// Public RPCs refuse wide eth_getLogs ranges, so the block of a submission is estimated from its time
// (finalizedAt minus the challenge period) and a narrow range around it is searched.
export function makeArchiveSource(cfg, { delayMs = 250 } = {}) {
  const ca = cfg.cawArchive;
  if (!ca) throw new Error('archive-check needs "cawArchive" in the config (rpcUrl and address of CawActionsArchive)');
  const arch = new JsonRpcProvider(ca.rpcUrl, ca.chainId, { staticNetwork: true, batchMaxCount: 1 });
  const base = new JsonRpcProvider(cfg.rpcUrl, cfg.chainId, { staticNetwork: true, batchMaxCount: 1 });
  const archive = new Contract(ca.address, ARCHIVE_ABI, arch);
  const actions = new Contract(cfg.cawActions, ['function networkHashAtCheckpoint(uint32,uint256) view returns (bytes32)'], base);
  let period = null;

  async function blockAtTime(ts) {
    const head = await withTimeout(() => arch.getBlock('latest'), 'archive latest block');
    const refNo = Math.max(1, head.number - 2000000);
    const ref = await withTimeout(() => arch.getBlock(refNo), 'archive block');
    const rate = (head.number - ref.number) / Math.max(1, head.timestamp - ref.timestamp);
    let n = Math.max(1, Math.round(head.number - (head.timestamp - ts) * rate));
    for (let i = 0; i < 4; i++) {
      await sleep(delayMs);
      const b = await withTimeout(() => arch.getBlock(n), 'archive block');
      n = Math.max(1, n + Math.round((ts - b.timestamp) * rate));
    }
    return n;
  }

  return {
    describe: { archive: ca.address, archiveChainId: ca.chainId },
    async nextSubmissionId() { return Number(await withTimeout(() => archive.nextSubmissionId(), 'nextSubmissionId')); },
    async submission(idNo) {
      const s = await withTimeout(() => archive.submissions(idNo), 'submissions');
      return {
        id: idNo, submitter: s.submitter, merkleRoot: s.merkleRoot, networkId: Number(s.networkId),
        startCheckpointId: Number(s.startCheckpointId), endCheckpointId: Number(s.endCheckpointId),
        finalizedAt: Number(s.finalizedAt), status: Number(s.status), dataCommitment: s.dataCommitment,
      };
    },
    // The arguments of the submitReplication call that created the submission
    async submitCall(sub) {
      if (period === null) period = Number(await withTimeout(() => archive.CHALLENGE_PERIOD(), 'CHALLENGE_PERIOD'));
      const centre = await blockAtTime(sub.finalizedAt - period);
      const idTopic = zeroPadValue(toBeHex(sub.id), 32);
      let found = null;
      for (let off = 0; off <= 40000 && !found; off += 4000) {
        for (const sgn of off === 0 ? [1] : [1, -1]) {
          await sleep(delayMs);
          const from = Math.max(1, centre + sgn * off - 2000);
          const logs = await withTimeout(() => arch.getLogs({ address: ca.address, topics: [SUBMISSION_CREATED, idTopic], fromBlock: from, toBlock: from + 4000 }), 'archive eth_getLogs');
          if (logs.length) { found = logs[0]; break; }
        }
      }
      if (!found) throw new Error('Could not find the transaction of submission ' + sub.id + ' near block ' + centre);
      const t = await withTimeout(() => arch.getTransaction(found.transactionHash), 'archive transaction');
      if (!t) throw new Error('No transaction body for ' + found.transactionHash);
      let parsed;
      try { parsed = iface.parseTransaction({ data: t.data }); } catch { parsed = null; }
      if (!parsed || parsed.name !== 'submitReplication') throw new Error('Transaction ' + found.transactionHash + ' is not a direct submitReplication call');
      const [, , , packed, r, merkleRoot, entryHash] = parsed.args;
      return { tx: found.transactionHash, block: found.blockNumber, packed, r: [...r], merkleRoot, entryHash };
    },
    async checkpointHash(networkId, cp) {
      await sleep(delayMs);
      return withTimeout(() => actions.networkHashAtCheckpoint(networkId, cp), 'networkHashAtCheckpoint');
    },
  };
}

// Runs every check for one submission. db may be null (then the comparison with this reader's data is not done).
export async function verifySubmission(source, sub, db) {
  const call = await source.submitCall(sub);
  const res = checkSubmission(sub, call);
  const { checks, fold, start } = res;
  const shapeOk = checks.find((c) => c.name === 'shape').ok;

  if (shapeOk) {
    let match = 0;
    const bad = [];
    for (let i = 0; i < fold.cpHashes.length; i++) {
      const onChain = await source.checkpointHash(sub.networkId, start + i);
      if (onChain === fold.cpHashes[i]) match++; else bad.push(start + i);
    }
    checks.push(check('checkpoint hashes', match === fold.cpHashes.length,
      match + '/' + fold.cpHashes.length + ' equal networkHashAtCheckpoint on the source chain' + (bad.length ? ' (differs at ' + bad.join(', ') + ')' : '')));
    const prev = start - 1;
    const wanted = prev === 0 ? ZERO_HASH : await source.checkpointHash(sub.networkId, prev);
    checks.push(check('entry hash', call.entryHash === wanted,
      prev === 0 ? 'starts at checkpoint 1: the zero hash' : 'equals networkHashAtCheckpoint at checkpoint ' + prev));
  } else {
    checks.push(check('checkpoint hashes', null, 'not checked: the shape check failed'));
    checks.push(check('entry hash', null, 'not checked: the shape check failed'));
  }

  let cmp = null;
  if (db && shapeOk) {
    cmp = compareWithDb(db, call.packed);
    const parts = [cmp.matched + ' equal'];
    if (cmp.notInDb.length) parts.push(cmp.notInDb.length + ' not read yet by this reader');
    if (cmp.ambiguous.length) parts.push(cmp.ambiguous.length + ' ambiguous (reported separately)');
    if (cmp.mismatched.length) parts.push(cmp.mismatched.length + ' DIFFER');
    // Nothing compared (an empty or not yet synced database) is "not checked", never a pass
    const verdict = cmp.mismatched.length ? false : cmp.matched > 0 ? true : null;
    checks.push(check('actions vs this reader', verdict, (verdict === null ? 'NOT CHECKED, no action compared: ' : '') + parts.join(', ')));
  } else {
    checks.push(check('actions vs this reader', null, db ? 'not checked: the shape check failed' : 'not checked: no database of this reader'));
  }
  return { sub, call: { tx: call.tx, block: call.block }, checks, comparison: cmp, ok: checks.every((c) => c.ok !== false) };
}

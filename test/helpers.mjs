// SPDX-License-Identifier: MIT
// Test helpers: building actions as in the spec memo section "Byte layout of packedActions", and a fake chain.

import { Interface, getBytes, hexlify, keccak256, zeroPadValue, toBeHex } from 'ethers';
import { EVENTS } from '../src/sync.mjs';

export function encodeAction(a) {
  const text = a.text instanceof Uint8Array ? a.text : new TextEncoder().encode(a.text ?? '');
  const recipients = a.recipients ?? [];
  const amounts = (a.amounts ?? []).map(BigInt);
  const out = [];
  const u = (v, n) => { for (let i = n - 1; i >= 0; i--) out.push(Number((BigInt(v) >> BigInt(8 * i)) & 0xffn)); };
  u(a.type ?? 0, 1); u(a.senderId, 4); u(a.receiverId ?? 0, 4); u(a.receiverCawonce ?? 0, 4);
  u(a.networkId ?? 1, 4); u(a.cawonce, 4); u(recipients.length, 1); u(amounts.length, 1);
  for (const r of recipients) u(r, 4);
  for (const m of amounts) u(m, 8);
  u(text.length, 2);
  out.push(...text);
  return Uint8Array.from(out);
}

export function packActions(list) {
  const parts = list.map(encodeAction);
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(2 + n);
  out[0] = list.length >> 8; out[1] = list.length & 0xff;
  let o = 2;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function packErc1271Groups(groups) {
  const chunks = [];
  for (const g of groups) {
    chunks.push(Uint8Array.from([g.length >> 8, g.length & 0xff]));
    for (const a of g) chunks.push(encodeAction(a));
  }
  const n = chunks.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export const CALLS = new Interface([
  'function processActions(uint32 validatorId, bytes packedActions, bytes sigs, uint256 withdrawFee, uint256 withdrawLzTokenAmount)',
  'function safeProcessActions(uint32 validatorId, bytes packedActions, bytes sigs, uint256 withdrawFee, uint256 withdrawLzTokenAmount)',
  'function processActionsWithZkSigs(uint32 validatorId, bytes packedActions, bytes packedSigs, bytes signers, bytes proof, uint256 withdrawFee, uint256 withdrawLzTokenAmount)',
  'function processActionsERC1271(uint32 validatorId, bytes packedActions, bytes[] sigs, bytes32[] rs, uint256 withdrawFee, uint256 withdrawLzTokenAmount)',
  // Example of a call through another contract (such as a wallet's execute)
  'function execute(address target, uint256 value, bytes data)',
]);

export const ADDR = {
  actions: '0x73246104f57001EDC6d0659Fa37Afb672a76E763',
  ledger: '0x93593A023629EB84B389770d76A81C5f982F02a9',
  erc1271: '0x1111111111111111111111111111111111111111',
};

export function cfgFor(extra = {}) {
  return {
    rpcUrl: 'http://fake', chainId: 84532, cawActions: ADDR.actions, cawActionsErc1271: ADDR.erc1271,
    ledger: ADDR.ledger, startBlock: 100, confirmations: 2, logWindow: 1000, pollSeconds: 1, ...extra,
  };
}

const bh = (n) => zeroPadValue(toBeHex(n), 32);

// A fake chain. Logs, transactions and blocks are laid out by hand.
export function fakeChain() {
  const logs = [];
  const txs = new Map();
  const names = new Map();
  let txn = 0;
  const c = {
    head: 1000,
    failTx: new Set(),        // hashes in here return no body (a transient failure)
    maxRange: Infinity,       // refuse getLogs ranges wider than this
    blockHashOverride: new Map(),
    calls: { getLogs: [] },
    addTx(data) {
      const hash = '0x' + (++txn).toString(16).padStart(64, '0');
      txs.set(hash, hexlify(data));
      return hash;
    },
    addLog(address, name, values, block, txHash, index) {
      const { data, topics } = EVENTS.encodeEventLog(EVENTS.getEvent(name), values);
      logs.push({ address, topics, data, blockNumber: block, blockHash: bh(block), transactionHash: txHash, index });
    },
    setName(id, name) { names.set(id, name); },
    async getBlockNumber() { return c.head; },
    async getLogs(f) {
      c.calls.getLogs.push([f.fromBlock, f.toBlock]);
      if (f.toBlock - f.fromBlock + 1 > c.maxRange) throw new Error('query exceeds max block range');
      const addrs = new Set(f.address.map((a) => a.toLowerCase()));
      const ts = new Set(f.topics[0]);
      return logs.filter((l) => l.blockNumber >= f.fromBlock && l.blockNumber <= f.toBlock
        && addrs.has(l.address.toLowerCase()) && ts.has(l.topics[0]));
    },
    async getTransaction(h) { return c.failTx.has(h) ? null : (txs.has(h) ? { hash: h, data: txs.get(h) } : null); },
    async getBlock(n) { return { number: n, hash: c.blockHashOverride.get(n) ?? bh(n), timestamp: 1700000000 + n * 2 }; },
    async username(id) { if (!names.has(id)) throw new Error('no name'); return names.get(id); },
  };
  return c;
}

export { getBytes, keccak256, hexlify };

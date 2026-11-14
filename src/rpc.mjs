// SPDX-License-Identifier: MIT
//
// RPC connection. Read calls only; no writes, no signing, no keys.

import { Contract, JsonRpcProvider } from 'ethers';

// Puts an error on one line, including the RPC response body (e.error / e.info) that ethers tends to drop
export function describeError(e) {
  if (!e) return String(e);
  const parts = [e.shortMessage || e.message];
  if (e.code) parts.push('code=' + e.code);
  for (const k of ['error', 'info']) {
    if (e[k] == null) continue;
    let v = e[k];
    // The request payload is long and does not show the cause, so drop it. Keep the response status and body
    if (k === 'info' && typeof v === 'object') { v = { ...v }; delete v.payload; }
    try { v = JSON.stringify(v); } catch { v = String(v); }
    if (v !== '{}') parts.push(k + '=' + v);
  }
  return parts.join(' | ').slice(0, 600);
}

// Whether the RPC says it does not have old history (pruned). Re-reading never changes this
export function isPruned(e) {
  return /pruned|history unavailable|missing trie node|historical state .*not available/i.test(describeError(e));
}

// Whether the RPC refused because the range is too wide (HTTP 413 or wording with range/limit; same check as the viewer)
export function isRangeTooLarge(e) {
  // Do not mistake a rate-limit response ("rate limit" etc.) for a range problem
  if (isRateLimited(e)) return false;
  const s = describeError(e);
  return /\b413\b|too large|range|limit|exceed|too many/i.test(s);
}
export function isRateLimited(e) {
  const s = describeError(e);
  return /\b429\b|rate.?limit|too many requests/i.test(s);
}

// Time limit for one call, so that reading does not hang with no response
const CALL_TIMEOUT_MS = 30000;
function withTimeout(p, what) {
  let t;
  const timeout = new Promise((_, reject) => { t = setTimeout(() => reject(new Error('No response from RPC (' + what + ', ' + CALL_TIMEOUT_MS / 1000 + ' s)')), CALL_TIMEOUT_MS); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

export function makeChain(cfg) {
  // batchMaxCount: 1 ... do not combine calls into one POST (public RPCs refuse large requests with 413)
  const mk = (url) => new JsonRpcProvider(url, cfg.chainId, { staticNetwork: true, batchMaxCount: 1 });
  const provider = mk(cfg.rpcUrl);
  // Optional endpoint queried only when the main RPC has pruned the history
  const archive = cfg.archiveRpcUrl ? mk(cfg.archiveRpcUrl) : null;
  const usage = { archiveCalls: 0 };

  // Ask rpcUrl first, and ask archiveRpcUrl only when rpcUrl reports pruned history
  const call = async (what, fn) => {
    try {
      return await withTimeout(fn(provider), what);
    } catch (e) {
      if (!archive || !isPruned(e)) throw e;
      usage.archiveCalls++;
      return withTimeout(fn(archive), what + ' (archive)');
    }
  };
  const ledgerOn = (p) => new Contract(cfg.ledger, ['function usernames(uint32) view returns (string)'], p);

  // CawProfile on L1 (username NFTs). Names are at usernames[tokenId - 1] (CawProfile.sol:77, 246)
  let l1 = null;
  if (cfg.l1RpcUrl && cfg.cawProfile) {
    const p1 = new JsonRpcProvider(cfg.l1RpcUrl, cfg.l1ChainId, { staticNetwork: true, batchMaxCount: 1 });
    const profile = new Contract(cfg.cawProfile, ['function nextId() view returns (uint32)', 'function usernames(uint256) view returns (string)'], p1);
    l1 = {
      async getBlockNumber() { return withTimeout(p1.getBlockNumber(), 'L1 eth_blockNumber'); },
      async nextId(blockTag) { return Number(await withTimeout(profile.nextId({ blockTag }), 'L1 nextId')); },
      async username(id, blockTag) { return withTimeout(profile.usernames(id - 1, { blockTag }), 'L1 usernames'); },
    };
  }

  return {
    provider, usage, l1,
    async getBlockNumber() { return withTimeout(provider.getBlockNumber(), 'eth_blockNumber'); },
    async getLogs(filter) {
      const logs = await call('eth_getLogs', (p) => p.getLogs(filter));
      return logs.map((l) => ({
        address: l.address, topics: l.topics, data: l.data,
        blockNumber: l.blockNumber, blockHash: l.blockHash,
        transactionHash: l.transactionHash, index: l.index,
      }));
    },
    async getTransaction(hash) {
      const t = await call('eth_getTransactionByHash', (p) => p.getTransaction(hash));
      return t ? { hash: t.hash, to: t.to, data: t.data, blockNumber: t.blockNumber } : null;
    },
    async getBlock(n) {
      const b = await call('eth_getBlockByNumber', (p) => p.getBlock(n));
      return b ? { number: b.number, hash: b.hash, timestamp: b.timestamp } : null;
    },
    async username(id) { return withTimeout(ledgerOn(provider).usernames(id), 'usernames'); },
    async getCode(address, block) { return call('eth_getCode', (p) => p.getCode(address, block)); },
  };
}

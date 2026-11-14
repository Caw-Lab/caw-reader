// SPDX-License-Identifier: MIT
//
// Reads the chain from the oldest block forward and stores actions in the DB.
//
// Rules:
// - A range (a span of blocks) counts as read only when all of it has been written to the DB.
//   Transient failures, such as a transaction body or block that cannot be fetched, do not move
//   reading forward (the principle of upstream PR #60).
// - Only blocks at least `confirmations` behind the chain head are read (same idea as upstream PR #76).
// - A batch with no bytes in its calldata matching batchHash is not dropped. It is kept as
//   "unresolved" and counted in the status (re-reading cannot change the result, so reading does
//   not stop there).

import { Interface, getBytes, hexlify } from 'ethers';
import { decodePacked, findErc1271Group, findPackedForBatch } from './decode.mjs';
import { getMeta, setMeta, tx } from './db.mjs';
import { describeError, isPruned, isRangeTooLarge, isRateLimited } from './rpc.mjs';
import { indexOther, indexCawTips } from './other.mjs';

export const EVENTS = new Interface([
  'event ActionsProcessed(uint32 indexed networkId, uint32 indexed validatorId, uint16 actionCount, bytes32 batchHash)',
  'event ActionsProcessedZk(uint32 indexed networkId, uint32 indexed validatorId, uint16 actionCount, uint256 actionsExecutedBitmap, bytes32 batchHash)',
  'event ActionRejected(uint32 senderId, uint32 cawonce, bytes reason)',
  'event OwnerSet(uint32 tokenId, address newOwner)',
  'event UsernameMinted(uint32 tokenId, address owner)',
]);
const T = Object.fromEntries(['ActionsProcessed', 'ActionsProcessedZk', 'ActionRejected', 'OwnerSet', 'UsernameMinted']
  .map((n) => [n, EVENTS.getEvent(n).topicHash]));

// Order on the chain: block -> log index -> position in the batch (up to 256)
export function seqOf(block, logIndex, idx = 0) {
  if (block >= 2 ** 31) throw new Error('Block number is larger than expected (' + block + ')');
  if (logIndex >= 8192) throw new Error('Log index is larger than expected (' + logIndex + ')');
  return block * 4194304 + logIndex * 512 + idx;
}

class TransientError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---- Logs of one range -> what to write -------------------------------------------
// Nothing is written to the DB here. Everything needed is collected from the RPC; on failure, an exception is thrown.
export async function collectRange(chain, cfg, logs) {
  const actionsAddr = cfg.cawActions.toLowerCase();
  const erc1271Addr = cfg.cawActionsErc1271 ? cfg.cawActionsErc1271.toLowerCase() : null;
  const ledgerAddr = cfg.ledger.toLowerCase();

  logs = [...logs].sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
  const out = { batches: [], ledger: [], anomalies: [] };
  const txCache = new Map();
  const blockCache = new Map();
  // ActionRejected events in the same transaction since the previous CawActions ActionsProcessed
  const pendingRej = new Map();

  const getTx = async (hash) => {
    if (!txCache.has(hash)) {
      const t = await chain.getTransaction(hash);
      if (!t || !t.data) throw new TransientError('Could not fetch the transaction body: ' + hash);
      txCache.set(hash, getBytes(t.data));
    }
    return txCache.get(hash);
  };
  const getTime = async (n, hash) => {
    if (!blockCache.has(n)) {
      const b = await chain.getBlock(n);
      if (!b) throw new TransientError('Could not fetch the block: ' + n);
      // If the block in the log differs from the block readable now (a reorg in progress), read this range again
      if (hash && b.hash && b.hash !== hash) throw new TransientError('Hash of block ' + n + ' does not match the log (possible reorg)');
      blockCache.set(n, b.timestamp);
    }
    return blockCache.get(n);
  };

  for (const l of logs) {
    const addr = l.address.toLowerCase();
    const t0 = l.topics[0];

    if (addr === ledgerAddr && (t0 === T.UsernameMinted || t0 === T.OwnerSet)) {
      const ev = EVENTS.parseLog(l);
      out.ledger.push({
        kind: ev.name, tokenId: Number(ev.args[0]), owner: ev.args[1],
        block: l.blockNumber, seq: seqOf(l.blockNumber, l.index),
      });
      continue;
    }

    if (addr === actionsAddr && t0 === T.ActionRejected) {
      const ev = EVENTS.parseLog(l);
      const k = l.transactionHash;
      if (!pendingRej.has(k)) pendingRej.set(k, []);
      pendingRej.get(k).push({ senderId: Number(ev.args.senderId), cawonce: Number(ev.args.cawonce), reason: ev.args.reason });
      continue;
    }

    const isActions = addr === actionsAddr && (t0 === T.ActionsProcessed || t0 === T.ActionsProcessedZk);
    const isErc1271 = erc1271Addr && addr === erc1271Addr && t0 === T.ActionsProcessed;
    if (!isActions && !isErc1271) continue;

    const ev = EVENTS.parseLog(l);
    const zk = t0 === T.ActionsProcessedZk;
    const b = {
      block: l.blockNumber, time: await getTime(l.blockNumber, l.blockHash),
      txHash: l.transactionHash, logIndex: l.index,
      contract: isErc1271 ? 'erc1271' : 'actions', kind: zk ? 'zk' : 'sig',
      networkId: Number(ev.args.networkId), validatorId: Number(ev.args.validatorId),
      actionCount: Number(ev.args.actionCount), batchHash: ev.args.batchHash,
      resolved: false, note: null, actions: [],
    };
    const rejections = isActions ? (pendingRej.get(l.transactionHash) || []) : [];
    if (isActions) pendingRej.set(l.transactionHash, []);

    const data = await getTx(l.transactionHash);
    let decoded = null;
    let exhausted = false;
    if (isErc1271) {
      const r = findErc1271Group(data, b.batchHash, b.actionCount);
      exhausted = r.exhausted;
      if (r.found) decoded = r.found.actions;
    } else {
      const r = findPackedForBatch(data, b.batchHash, b.actionCount);
      exhausted = r.exhausted;
      if (r.found) {
        try {
          const d = decodePacked(r.found);
          if (d.trailing !== 0) b.note = 'batchHash matched, but ' + d.trailing + ' trailing bytes remain';
          else decoded = d.actions;
        } catch (e) {
          b.note = 'batchHash matched, but the bytes cannot be decoded (' + e.message + ')';
        }
      }
    }
    if (!decoded) {
      b.note = b.note || (exhausted
        ? 'The calldata search hit its limit (' + data.length + ' bytes of calldata) and stopped before finding bytes matching batchHash'
        : 'No bytes matching batchHash were found in the calldata');
      out.anomalies.push({ block: b.block, txHash: b.txHash, kind: 'unresolved_batch', detail: b.note });
      if (rejections.length) out.anomalies.push({ block: b.block, txHash: b.txHash, kind: 'unmatched_rejections', detail: JSON.stringify(rejections.map((r) => [r.senderId, r.cawonce])) });
      out.batches.push(b);
      continue;
    }
    b.resolved = true;

    // Decide the status of each action
    const status = decoded.map(() => 'accepted');
    const reason = decoded.map(() => null);
    if (zk) {
      const bitmap = BigInt(ev.args.actionsExecutedBitmap);
      decoded.forEach((_, i) => { if (((bitmap >> BigInt(i)) & 1n) === 0n) status[i] = 'skipped'; });
    } else if (rejections.length) {
      // Rejections are linked to actions by (senderId, cawonce). If the same pair appears twice or
      // more in one batch with different contents, the logs cannot tell which one was rejected,
      // so it is marked "ambiguous".
      const rejByKey = new Map();
      for (const r of rejections) {
        const k = r.senderId + ':' + r.cawonce;
        if (!rejByKey.has(k)) rejByKey.set(k, []);
        rejByKey.get(k).push(r);
      }
      const idxByKey = new Map();
      decoded.forEach((a, i) => {
        const k = a.senderId + ':' + a.cawonce;
        if (!idxByKey.has(k)) idxByKey.set(k, []);
        idxByKey.get(k).push(i);
      });
      for (const [k, rs] of rejByKey) {
        const idxs = idxByKey.get(k) || [];
        if (idxs.length === 0 || rs.length > idxs.length) {
          out.anomalies.push({ block: b.block, txHash: b.txHash, kind: 'unmatched_rejections', detail: k + ': ' + rs.length + ' rejection(s), ' + idxs.length + ' action(s)' });
          for (const i of idxs) status[i] = 'ambiguous';
          continue;
        }
        const first = hexlify(decoded[idxs[0]].raw);
        const identical = idxs.every((i) => hexlify(decoded[i].raw) === first);
        if (idxs.length > 1 && !identical) {
          out.anomalies.push({ block: b.block, txHash: b.txHash, kind: 'ambiguous_rejection', detail: k + ': ' + idxs.length + ' actions with different contents in the same batch' });
          for (const i of idxs) status[i] = 'ambiguous';
          continue;
        }
        // A single action, or repeats of an identical action: mark as many from the end as were rejected
        const tail = idxs.slice(idxs.length - rs.length);
        tail.forEach((i, j) => { status[i] = 'rejected'; reason[i] = rs[j].reason; });
      }
    }
    b.actions = decoded.map((a, i) => ({ ...a, idx: i, status: status[i], reason: reason[i] }));
    out.batches.push(b);
  }

  for (const [txHash, rs] of pendingRej) {
    if (rs.length) out.anomalies.push({ block: null, txHash, kind: 'unmatched_rejections', detail: rs.length + ' ActionRejected event(s) without ActionsProcessed' });
  }
  return out;
}

// ---- What to write -> DB ----------------------------------------------------------
export function writeRange(db, collected, nextBlock) {
  return tx(db, () => {
    const insBatch = db.prepare(`INSERT INTO batches (block_number, block_time, tx_hash, log_index, contract, kind,
      network_id, validator_id, action_count, batch_hash, resolved, note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT (tx_hash, log_index) DO NOTHING RETURNING id`);
    const findAccepted = db.prepare("SELECT seq FROM actions WHERE sender_id = ? AND cawonce = ? AND status = 'accepted'");
    const insAction = db.prepare(`INSERT INTO actions (seq, batch_id, idx, status, type, sender_id, receiver_id, receiver_cawonce,
      network_id, cawonce, recipients, amounts, text, reject_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insUser = db.prepare('INSERT INTO users (id) VALUES (?) ON CONFLICT (id) DO NOTHING');
    const upFollow = db.prepare(`INSERT INTO follows (follower_id, target_id, following, seq) VALUES (?,?,?,?)
      ON CONFLICT (follower_id, target_id) DO UPDATE SET following = excluded.following, seq = excluded.seq
      WHERE excluded.seq > follows.seq`);
    const upMint = db.prepare(`INSERT INTO users (id, owner, owner_seq, minted_block, name_checked) VALUES (?,?,?,?,0)
      ON CONFLICT (id) DO UPDATE SET minted_block = excluded.minted_block, name_checked = 0,
        owner = CASE WHEN users.owner_seq IS NULL OR excluded.owner_seq > users.owner_seq THEN excluded.owner ELSE users.owner END,
        owner_seq = CASE WHEN users.owner_seq IS NULL OR excluded.owner_seq > users.owner_seq THEN excluded.owner_seq ELSE users.owner_seq END`);
    const upOwner = db.prepare(`INSERT INTO users (id, owner, owner_seq) VALUES (?,?,?)
      ON CONFLICT (id) DO UPDATE SET owner = excluded.owner, owner_seq = excluded.owner_seq
      WHERE users.owner_seq IS NULL OR excluded.owner_seq > users.owner_seq`);
    const insAnomaly = db.prepare('INSERT INTO anomalies (block_number, tx_hash, kind, detail) VALUES (?,?,?,?)');

    let added = 0;
    for (const b of collected.batches) {
      const row = insBatch.get(b.block, b.time, b.txHash, b.logIndex, b.contract, b.kind, b.networkId, b.validatorId,
        b.actionCount, b.batchHash, b.resolved ? 1 : 0, b.note);
      if (!row) continue; // Already written (when the same range is read again)
      for (const a of b.actions) {
        const seq = seqOf(b.block, b.logIndex, a.idx);
        let status = a.status;
        if (status === 'accepted' && findAccepted.get(a.senderId, a.cawonce)) {
          status = 'duplicate';
          insAnomaly.run(b.block, b.txHash, 'duplicate_cawonce', a.senderId + ':' + a.cawonce + ' was already accepted');
        }
        insAction.run(seq, row.id, a.idx, status, a.type, a.senderId, a.receiverId, a.receiverCawonce, a.networkId,
          a.cawonce, JSON.stringify(a.recipients), JSON.stringify(a.amounts.map(String)), a.text,
          a.reason == null ? null : hexlify(a.reason));
        insUser.run(a.senderId);
        if (a.receiverId) insUser.run(a.receiverId);
        if (status === 'accepted' && (a.type === 4 || a.type === 5) && a.receiverId) {
          upFollow.run(a.senderId, a.receiverId, a.type === 4 ? 1 : 0, seq);
        }
        added++;
      }
    }
    for (const e of collected.ledger) {
      if (e.kind === 'UsernameMinted') upMint.run(e.tokenId, e.owner, e.seq, e.block);
      else upOwner.run(e.tokenId, e.owner, e.seq);
    }
    for (const a of collected.anomalies) insAnomaly.run(a.block, a.txHash, a.kind, a.detail);
    setMeta(db, 'next_block', nextBlock);
    return added;
  });
}

// ---- Advancing through ranges ---------------------------------------------------------
export async function syncOnce(db, chain, cfg, { onRange, stopAt } = {}) {
  let next = Number(getMeta(db, 'next_block'));
  if (getMeta(db, 'next_block') == null) {
    if (cfg.startBlock == null) throw new Error('startBlock is not set. Run `find-start` to find the CawActions deployment block, then set it');
    next = cfg.startBlock;
    setMeta(db, 'next_block', next);
  }
  const head = await chain.getBlockNumber();
  const target = Math.min(stopAt ?? Infinity, head - cfg.confirmations);
  setMeta(db, 'head_seen', head);

  const addresses = [cfg.cawActions, cfg.ledger];
  if (cfg.cawActionsErc1271) addresses.push(cfg.cawActionsErc1271);
  const topics = [[T.ActionsProcessed, T.ActionsProcessedZk, T.ActionRejected, T.OwnerSet, T.UsernameMinted]];

  let win = Number(getMeta(db, 'log_window')) || cfg.logWindow;
  win = Math.min(win, cfg.logWindow);
  // Never go back to a width (or wider) that was once refused
  let ceiling = Number(getMeta(db, 'log_window_ceiling')) || Infinity;
  let waits = 0, okStreak = 0, total = 0;
  while (next <= target) {
    const to = Math.min(next + win - 1, target);
    let logs;
    try {
      logs = await chain.getLogs({ address: addresses, topics, fromBlock: next, toBlock: to });
    } catch (e) {
      if (isRateLimited(e) && waits < 8) { waits++; log('Rate limited; waiting ' + waits + ' s: ' + describeError(e)); await sleep(1000 * waits); continue; }
      // When the range is refused as too wide, or the call times out with no response, halve the range
      if (win > 1 && (isRangeTooLarge(e) || /No response from RPC/.test(e.message || ''))) {
        ceiling = Math.min(ceiling, to - next + 1);
        setMeta(db, 'log_window_ceiling', ceiling);
        win = Math.max(1, Math.floor(win / 2));
        log('Shrinking the range to ' + win + ' blocks: ' + describeError(e));
        setMeta(db, 'log_window', win);
        okStreak = 0;
        continue;
      }
      throw e;
    }
    waits = 0;
    const collected = await collectRange(chain, cfg, logs);
    const added = writeRange(db, collected, to + 1);
    total += added;
    if (onRange) onRange({ from: next, to, target, logs: logs.length, added, anomalies: collected.anomalies.length });
    next = to + 1;
    // After a run without refusals, widen the window step by step back to the configured value
    if (++okStreak >= 20 && win < cfg.logWindow && win * 2 < ceiling) { win = Math.min(cfg.logWindow, win * 2); setMeta(db, 'log_window', win); okStreak = 0; }
  }
  return { head, target, next, added: total };
}

// Reads usernames. A failure does not stop collection (it is tried again next time).
export async function refreshNames(db, chain, limit = 100) {
  const rows = db.prepare('SELECT id FROM users WHERE name_checked = 0 ORDER BY id LIMIT ?').all(limit);
  const up = db.prepare('UPDATE users SET name = ?, name_checked = 1 WHERE id = ?');
  let ok = 0;
  for (const { id } of rows) {
    try {
      const n = await chain.username(id);
      up.run(n || null, id);
      ok++;
    } catch (e) {
      log('Could not read the name of #' + id + ': ' + describeError(e));
      break;
    }
  }
  return ok;
}

// Reads L1 names added since the previous run. Names are an append-only array, so names once read are not read again.
// L1 is read at the state l1Confirmations blocks behind the head. A mismatch with the L2 name is recorded for review.
export async function refreshL1Names(db, chain, cfg, limit = 200) {
  if (!chain.l1) return 0;
  const head = await chain.l1.getBlockNumber();
  const tag = Math.max(0, head - cfg.l1Confirmations);
  const next = await chain.l1.nextId(tag);            // names are 1 .. next - 1
  let id = Number(getMeta(db, 'l1_names_next')) || 1;
  const up = db.prepare(`INSERT INTO users (id, l1_name) VALUES (?, ?)
    ON CONFLICT (id) DO UPDATE SET l1_name = excluded.l1_name`);
  const l2name = db.prepare('SELECT name FROM users WHERE id = ?');
  const insAnomaly = db.prepare('INSERT INTO anomalies (block_number, tx_hash, kind, detail) VALUES (?,?,?,?)');
  let n = 0;
  while (id < next && n < limit) {
    const name = await chain.l1.username(id, tag);
    tx(db, () => {
      up.run(id, name || null);
      const r = l2name.get(id);
      if (r && r.name && name && r.name !== name) insAnomaly.run(null, null, 'name_mismatch', '#' + id + ' L1 "' + name + '" / L2 "' + r.name + '"');
      setMeta(db, 'l1_names_next', id + 1);
    });
    id++; n++;
  }
  return n;
}

export async function runLoop(db, chain, cfg, { signal, onRange, getDecoder } = {}) {
  while (!signal?.aborted) {
    try {
      const r = await syncOnce(db, chain, cfg, { onRange });
      await refreshNames(db, chain);
      try { await refreshL1Names(db, chain, cfg); }
      catch (e) { log('Could not read L1 names (will try again next time): ' + describeError(e)); }
      while (indexCawTips(db) > 0) { /* catch up on the backlog */ }
      if (getDecoder) { while (indexOther(db, getDecoder()) > 0) { /* interpret the backlog */ } }
      setMeta(db, 'last_ok', Date.now());
      if (r.added) log('Caught up (head ' + r.head + ', next from ' + r.next + ')');
    } catch (e) {
      setMeta(db, 'last_error', describeError(e).slice(0, 500));
      if (isPruned(e)) {
        // Re-reading cannot change this, so stop reading instead of repeating the same failure (the UI and API stay up)
        log('Stopped reading: this RPC does not have the contents of the next block to read (around ' + getMeta(db, 'next_block') + ').');
        log('  RPC response: ' + describeError(e));
        log('  Put the URL of an RPC with full history (an archive) into rpcUrl in config.json and start again. Progress has been saved.');
        return;
      }
      log('Reading interrupted (progress saved; continuing next time): ' + describeError(e));
    }
    await sleep(cfg.pollSeconds * 1000);
  }
}

export { TransientError };

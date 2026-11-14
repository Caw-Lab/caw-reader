// SPDX-License-Identifier: MIT
import { test } from 'node:test';
import { getAddress } from 'ethers';
import assert from 'node:assert/strict';
import { openDb, getMeta, setMeta } from '../src/db.mjs';
import { syncOnce, refreshNames } from '../src/sync.mjs';
import { makeApi } from '../src/server.mjs';
import { fakeChain, cfgFor, packActions, packErc1271Groups, encodeAction, CALLS, ADDR, keccak256 } from './helpers.mjs';

const mem = () => openDb(':memory:');
const rows = (db, sql, ...a) => db.prepare(sql).all(...a);

// Puts one processActions / safeProcessActions batch on the fake chain
function putBatch(c, { block, index = 1, actions, fn = 'processActions', rejections = [], zkBitmap = null, wrap = false }) {
  const p = packActions(actions);
  let data = fn === 'processActionsWithZkSigs'
    ? CALLS.encodeFunctionData(fn, [9, p, '0x', '0x', '0x', 0, 0])
    : CALLS.encodeFunctionData(fn, [9, p, '0x', 0, 0]);
  if (wrap) data = CALLS.encodeFunctionData('execute', [ADDR.actions, 0, data]);
  const h = c.addTx(data);
  let i = index;
  for (const r of rejections) c.addLog(ADDR.actions, 'ActionRejected', [r.senderId, r.cawonce, '0xdeadbeef'], block, h, i++);
  if (zkBitmap != null) c.addLog(ADDR.actions, 'ActionsProcessedZk', [1, 9, actions.length, zkBitmap, keccak256(p)], block, h, i);
  else c.addLog(ADDR.actions, 'ActionsProcessed', [1, 9, actions.length, keccak256(p)], block, h, i);
  return h;
}

test('Stores posts, follows and names, and stops just behind the head', async () => {
  const db = mem(); const c = fakeChain(); const cfg = cfgFor();
  const mintTx = c.addTx('0x');
  c.addLog(ADDR.ledger, 'UsernameMinted', [2, '0x000000000000000000000000000000000000aaaa'], 150, mintTx, 0);
  c.addLog(ADDR.ledger, 'UsernameMinted', [13, '0x000000000000000000000000000000000000bbbb'], 150, mintTx, 1);
  c.setName(2, 'tenten'); c.setName(13, 'tentencaw');
  putBatch(c, { block: 200, actions: [
    { type: 0, senderId: 2, cawonce: 1, text: 'hello' },
    { type: 4, senderId: 13, receiverId: 2, cawonce: 1 },
  ] });
  putBatch(c, { block: 999, actions: [{ type: 0, senderId: 2, cawonce: 2, text: 'too new' }] }); // newer than head 1000 - confirmations 2

  const r = await syncOnce(db, c, cfg);
  assert.equal(r.next, 999);
  assert.equal(Number(getMeta(db, 'next_block')), 999);
  await refreshNames(db, c);
  const api = makeApi(db, () => null);
  const posts = api('/api/posts', new URLSearchParams()).items;
  assert.equal(posts.length, 1);
  assert.equal(posts[0].text, 'hello');
  assert.equal(posts[0].senderName, 'tenten');
  const u = api('/api/users/2', new URLSearchParams());
  assert.equal(u.followers, 1);
  assert.equal(u.owner, getAddress('0x000000000000000000000000000000000000aaaa'));
});

test('If a transaction body cannot be fetched, do not advance; read from the same place next time', async () => {
  const db = mem(); const c = fakeChain(); const cfg = cfgFor();
  const h = putBatch(c, { block: 300, actions: [{ type: 0, senderId: 2, cawonce: 1, text: 'x' }] });
  c.failTx.add(h);
  await assert.rejects(syncOnce(db, c, cfg), /Could not fetch the transaction body/);
  assert.equal(Number(getMeta(db, 'next_block')), 100);
  assert.equal(rows(db, 'SELECT * FROM actions').length, 0);
  c.failTx.delete(h);
  await syncOnce(db, c, cfg);
  assert.equal(rows(db, 'SELECT * FROM actions').length, 1);
});

test('If the block hash in the log differs from the current block (a reorg), do not advance', async () => {
  const db = mem(); const c = fakeChain(); const cfg = cfgFor();
  putBatch(c, { block: 300, actions: [{ type: 0, senderId: 2, cawonce: 1, text: 'x' }] });
  c.blockHashOverride.set(300, '0x' + 'ab'.repeat(32));
  await assert.rejects(syncOnce(db, c, cfg), /reorg/);
  assert.equal(Number(getMeta(db, 'next_block')), 100);
});

test('When a range is refused as too wide, halve the window and continue', async () => {
  const db = mem(); const c = fakeChain(); const cfg = cfgFor();
  c.maxRange = 300;
  putBatch(c, { block: 900, actions: [{ type: 0, senderId: 2, cawonce: 1, text: 'x' }] });
  await syncOnce(db, c, cfg);
  assert.equal(rows(db, 'SELECT * FROM actions').length, 1);
  assert.ok(c.calls.getLogs.every(([f, t]) => t - f + 1 <= 1000));
  assert.ok(Number(getMeta(db, 'log_window')) <= 300);
});

test('Never go back to a refused width (no shrink-widen-refuse loop)', async () => {
  const db = mem(); const c = fakeChain(); const cfg = cfgFor({ logWindow: 1000 });
  c.head = 100000; c.maxRange = 500;
  await syncOnce(db, c, cfg);
  const rejected = c.calls.getLogs.filter(([f, t]) => t - f + 1 > 500).length;
  assert.equal(rejected, 1);
  assert.equal(Number(getMeta(db, 'log_window_ceiling')), 1000);
});

test('Re-reading the same range adds no duplicates', async () => {
  const db = mem(); const c = fakeChain(); const cfg = cfgFor();
  putBatch(c, { block: 300, actions: [{ type: 0, senderId: 2, cawonce: 1, text: 'x' }, { type: 4, senderId: 3, receiverId: 2, cawonce: 1 }] });
  await syncOnce(db, c, cfg);
  setMeta(db, 'next_block', 100);
  await syncOnce(db, c, cfg);
  assert.equal(rows(db, 'SELECT * FROM batches').length, 1);
  assert.equal(rows(db, 'SELECT * FROM actions').length, 2);
  assert.equal(rows(db, 'SELECT * FROM anomalies').length, 0);
});

test('safe path: rejected actions are marked and not counted as follows', async () => {
  const db = mem(); const c = fakeChain(); const cfg = cfgFor();
  putBatch(c, { block: 300, fn: 'safeProcessActions', rejections: [{ senderId: 3, cawonce: 5 }], actions: [
    { type: 0, senderId: 2, cawonce: 1, text: 'ok' },
    { type: 4, senderId: 3, receiverId: 2, cawonce: 5 },
  ] });
  await syncOnce(db, c, cfg);
  const st = rows(db, 'SELECT sender_id, status, reject_reason FROM actions ORDER BY seq');
  assert.deepEqual(st.map((r) => r.status), ['accepted', 'rejected']);
  assert.equal(st[1].reject_reason, '0xdeadbeef');
  assert.equal(rows(db, 'SELECT * FROM follows WHERE following = 1').length, 0);
});

test('safe path: for repeats of an identical action, the later ones are treated as rejected', async () => {
  const db = mem(); const c = fakeChain(); const cfg = cfgFor();
  const a = { type: 0, senderId: 2, cawonce: 1, text: 'same' };
  putBatch(c, { block: 300, fn: 'safeProcessActions', rejections: [{ senderId: 2, cawonce: 1 }], actions: [a, a] });
  await syncOnce(db, c, cfg);
  assert.deepEqual(rows(db, 'SELECT status FROM actions ORDER BY seq').map((r) => r.status), ['accepted', 'rejected']);
});

test('safe path: two different actions with the same (senderId, cawonce) are marked ambiguous, not decided', async () => {
  const db = mem(); const c = fakeChain(); const cfg = cfgFor();
  putBatch(c, { block: 300, fn: 'safeProcessActions', rejections: [{ senderId: 2, cawonce: 1 }], actions: [
    { type: 0, senderId: 2, cawonce: 1, text: 'first' },
    { type: 0, senderId: 2, cawonce: 1, text: 'second' },
  ] });
  await syncOnce(db, c, cfg);
  assert.deepEqual(rows(db, 'SELECT status FROM actions ORDER BY seq').map((r) => r.status), ['ambiguous', 'ambiguous']);
  assert.equal(rows(db, "SELECT * FROM anomalies WHERE kind = 'ambiguous_rejection'").length, 1);
});

test('With two batches in one transaction, each rejection applies only to its own batch', async () => {
  const db = mem(); const c = fakeChain(); const cfg = cfgFor();
  const p1 = packActions([{ type: 0, senderId: 2, cawonce: 9, text: 'batch1' }]);
  const p2 = packActions([{ type: 0, senderId: 2, cawonce: 9, text: 'batch1' }]);
  // The same action sent twice, the second rejected (the first was accepted in another batch)
  const data = CALLS.encodeFunctionData('execute', [ADDR.actions, 0,
    CALLS.encodeFunctionData('safeProcessActions', [9, p1, '0x', 0, 0])]);
  const h = c.addTx(data);
  c.addLog(ADDR.actions, 'ActionsProcessed', [1, 9, 1, keccak256(p1)], 300, h, 1);
  c.addLog(ADDR.actions, 'ActionRejected', [2, 9, '0x'], 300, h, 2);
  c.addLog(ADDR.actions, 'ActionsProcessed', [1, 9, 1, keccak256(p2)], 300, h, 3);
  await syncOnce(db, c, cfg);
  assert.deepEqual(rows(db, 'SELECT status FROM actions ORDER BY seq').map((r) => r.status), ['accepted', 'rejected']);
});

test('ZK path: actions whose bitmap bit is 0 are marked skipped', async () => {
  const db = mem(); const c = fakeChain(); const cfg = cfgFor();
  putBatch(c, { block: 300, fn: 'processActionsWithZkSigs', zkBitmap: 0b101n, actions: [
    { type: 0, senderId: 2, cawonce: 1, text: 'a' },
    { type: 0, senderId: 2, cawonce: 2, text: 'b' },
    { type: 0, senderId: 2, cawonce: 3, text: 'c' },
  ] });
  await syncOnce(db, c, cfg);
  assert.deepEqual(rows(db, 'SELECT status FROM actions ORDER BY seq').map((r) => r.status), ['accepted', 'skipped', 'accepted']);
});

test('ERC1271 path: extracts actions from the per-group events', async () => {
  const db = mem(); const c = fakeChain(); const cfg = cfgFor();
  const g1 = [{ type: 0, senderId: 40, cawonce: 1, text: 'from a contract wallet' }];
  const g2 = [{ type: 1, senderId: 41, receiverId: 40, receiverCawonce: 1, cawonce: 1 }, { type: 4, senderId: 41, receiverId: 40, cawonce: 2 }];
  const packed = packErc1271Groups([g1, g2]);
  const h = c.addTx(CALLS.encodeFunctionData('processActionsERC1271', [9, packed, ['0x01', '0x02'], [keccak256('0x01'), keccak256('0x02')], 0, 0]));
  const g1b = encodeAction(g1[0]);
  const g2b = packed.subarray(2 + g1b.length + 2);
  c.addLog(ADDR.erc1271, 'ActionsProcessed', [1, 9, 1, keccak256(g1b)], 300, h, 0);
  c.addLog(ADDR.erc1271, 'ActionsProcessed', [1, 9, 2, keccak256(g2b)], 300, h, 1);
  await syncOnce(db, c, cfg);
  assert.deepEqual(rows(db, 'SELECT sender_id, type, status FROM actions ORDER BY seq').map((r) => [r.sender_id, r.type, r.status]),
    [[40, 0, 'accepted'], [41, 1, 'accepted'], [41, 4, 'accepted']]);
});

test('A batch missing from the calldata is kept as unresolved, and reading moves on', async () => {
  const db = mem(); const c = fakeChain(); const cfg = cfgFor();
  const h = c.addTx('0x12345678');
  c.addLog(ADDR.actions, 'ActionsProcessed', [1, 9, 1, '0x' + '77'.repeat(32)], 300, h, 0);
  putBatch(c, { block: 400, actions: [{ type: 0, senderId: 2, cawonce: 1, text: 'after' }] });
  await syncOnce(db, c, cfg);
  assert.deepEqual(rows(db, 'SELECT resolved FROM batches ORDER BY id').map((r) => r.resolved), [0, 1]);
  assert.equal(rows(db, "SELECT * FROM anomalies WHERE kind = 'unresolved_batch'").length, 1);
  assert.equal(makeApi(db, () => null)('/api/status', new URLSearchParams()).unresolved, 1);
});

test('An already accepted (senderId, cawonce) arriving as accepted again is recorded as a duplicate', async () => {
  const db = mem(); const c = fakeChain(); const cfg = cfgFor();
  putBatch(c, { block: 300, actions: [{ type: 0, senderId: 2, cawonce: 1, text: 'one' }] });
  putBatch(c, { block: 301, actions: [{ type: 0, senderId: 2, cawonce: 1, text: 'two' }] });
  await syncOnce(db, c, cfg);
  assert.deepEqual(rows(db, 'SELECT status FROM actions ORDER BY seq').map((r) => r.status), ['accepted', 'duplicate']);
  assert.equal(rows(db, "SELECT * FROM anomalies WHERE kind = 'duplicate_cawonce'").length, 1);
});

test('UNFOLLOW: the later one on the chain wins', async () => {
  const db = mem(); const c = fakeChain(); const cfg = cfgFor();
  putBatch(c, { block: 300, actions: [{ type: 4, senderId: 3, receiverId: 2, cawonce: 1 }] });
  putBatch(c, { block: 301, actions: [{ type: 5, senderId: 3, receiverId: 2, cawonce: 2 }] });
  await syncOnce(db, c, cfg);
  assert.equal(rows(db, 'SELECT following FROM follows')[0].following, 0);
});

test('A DB for different contracts is not used', async () => {
  const { checkFingerprint } = await import('../src/db.mjs');
  const { fingerprint } = await import('../src/config.mjs');
  const db = mem();
  checkFingerprint(db, fingerprint(cfgFor()));
  assert.throws(() => checkFingerprint(db, fingerprint(cfgFor({ cawActions: '0x2222222222222222222222222222222222222222' }))), /different chain or contracts/);
});

test('If the RPC lacks old history, reading stops and the position does not move', async () => {
  const { runLoop } = await import('../src/sync.mjs');
  const db = mem(); const c = fakeChain(); const cfg = cfgFor();
  putBatch(c, { block: 300, actions: [{ type: 0, senderId: 2, cawonce: 1, text: 'x' }] });
  c.getBlock = async () => { const e = new Error('could not coalesce error'); e.error = { code: 4444, message: 'pruned history unavailable: requested 300, earliest available 500' }; throw e; };
  await runLoop(db, c, cfg); // it must stop and return (not loop)
  assert.equal(Number(getMeta(db, 'next_block')), 100);
  assert.match(getMeta(db, 'last_error'), /pruned history unavailable/);
});

test('archiveRpcUrl is queried only when rpcUrl reports pruned history', async () => {
  const { makeChain } = await import('../src/rpc.mjs');
  const http = await import('node:http');
  const serve = (handler) => new Promise((ok) => { const s = http.createServer((req, res) => { let b = ''; req.on('data', (d) => b += d); req.on('end', () => { const j = JSON.parse(b); res.end(JSON.stringify({ jsonrpc: '2.0', id: j.id, ...handler(j) })); }); }).listen(0, '127.0.0.1', () => ok(s)); });
  const pruned = { error: { code: 4444, message: 'pruned history unavailable: requested 1, earliest available 500' } };
  const blk = (n) => ({ result: { number: '0x' + n.toString(16), hash: '0x' + '11'.repeat(32), parentHash: '0x' + '00'.repeat(32), timestamp: '0x10', nonce: '0x0000000000000000', difficulty: '0x0', gasLimit: '0x1', gasUsed: '0x0', miner: '0x' + '00'.repeat(20), extraData: '0x', transactions: [] } });
  const a = await serve((j) => (j.method === 'eth_getBlockByNumber' && parseInt(j.params[0], 16) < 500 ? pruned : blk(parseInt(j.params[0], 16))));
  let archiveHits = 0;
  const b = await serve((j) => { archiveHits++; return blk(parseInt(j.params[0], 16)); });
  const url = (s) => 'http://127.0.0.1:' + s.address().port;
  try {
    const chain = makeChain({ ...cfgFor(), rpcUrl: url(a), archiveRpcUrl: url(b) });
    assert.equal((await chain.getBlock(600)).number, 600);
    assert.equal(archiveHits, 0);
    assert.equal((await chain.getBlock(300)).number, 300);
    assert.equal(archiveHits, 1);
    assert.equal(chain.usage.archiveCalls, 1);
    // without an archive, the pruning error propagates as is
    const solo = makeChain({ ...cfgFor(), rpcUrl: url(a) });
    await assert.rejects(solo.getBlock(300), /pruned history unavailable/);
  } finally { a.close(); b.close(); }
});

test('Reads only newly added L1 names, fills tokenIds without an L2 name, and records mismatches for review', async () => {
  const { refreshL1Names, refreshNames } = await import('../src/sync.mjs');
  const db = mem(); const c = fakeChain(); const cfg = cfgFor({ l1Confirmations: 12 });
  const l1names = ['tenten', 'vampire', 'cawobservatory'];   // tokenId 1, 2, 3
  const asked = [];
  c.l1 = {
    head: 500,
    async getBlockNumber() { return this.head; },
    async nextId(tag) { asked.push(tag); return l1names.length + 1; },
    async username(id, tag) { asked.push(tag); return l1names[id - 1]; },
  };
  putBatch(c, { block: 300, actions: [{ type: 0, senderId: 2, cawonce: 1, text: 'hi' }] });
  c.setName(2, 'not-vampire'); // L2 name differs from L1
  await syncOnce(db, c, cfg);
  await refreshNames(db, c);
  assert.equal(await refreshL1Names(db, c, cfg), 3);
  assert.ok(asked.every((t) => t === 488));                 // head 500 - 12
  const api = makeApi(db, () => null);
  assert.equal(api('/api/users/3', new URLSearchParams()).name, 'cawobservatory');  // tokenIds without actions are included too
  assert.equal(api('/api/users/2', new URLSearchParams()).l1Name, 'vampire');
  assert.equal(rows(db, "SELECT * FROM anomalies WHERE kind = 'name_mismatch'").length, 1);
  // the second run reads only new names (0 if none)
  assert.equal(await refreshL1Names(db, c, cfg), 0);
  l1names.push('nyaromekey7');
  assert.equal(await refreshL1Names(db, c, cfg), 1);
  assert.equal(api('/api/status', new URLSearchParams()).users, 4);
});

test('An earlier-version DB (without the l1_name column) can be opened; the column is added', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const f = join(mkdtempSync(join(tmpdir(), 'cr-')), 'old.sqlite');
  const old = new DatabaseSync(f);
  old.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, owner TEXT, owner_seq INTEGER, minted_block INTEGER, name_checked INTEGER NOT NULL DEFAULT 0)');
  old.exec("INSERT INTO users (id, name) VALUES (2, 'tenten')");
  old.close();
  const db = openDb(f);
  assert.ok(db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'l1_name'));
  assert.equal(db.prepare('SELECT name FROM users WHERE id = 2').get().name, 'tenten');
});

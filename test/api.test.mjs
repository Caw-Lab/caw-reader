// SPDX-License-Identifier: MIT
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.mjs';
import { syncOnce, refreshNames } from '../src/sync.mjs';
import { indexCawTips } from '../src/other.mjs';
import { makeApi } from '../src/server.mjs';
import { fakeChain, cfgFor, packActions, CALLS, ADDR, keccak256 } from './helpers.mjs';

function putBatch(c, block, actions) {
  const p = packActions(actions);
  const h = c.addTx(CALLS.encodeFunctionData('processActions', [9, p, '0x', 0, 0]));
  c.addLog(ADDR.actions, 'ActionsProcessed', [1, 9, actions.length, keccak256(p)], block, h, 1);
  return h;
}

async function sample() {
  const db = openDb(':memory:'); const c = fakeChain(); const cfg = cfgFor();
  const mint = c.addTx('0x');
  c.addLog(ADDR.ledger, 'UsernameMinted', [2, '0x000000000000000000000000000000000000aaaa'], 150, mint, 0);
  c.addLog(ADDR.ledger, 'UsernameMinted', [13, '0x000000000000000000000000000000000000bbbb'], 150, mint, 1);
  c.setName(2, 'tenten'); c.setName(13, 'tentencaw');
  const postTx = putBatch(c, 200, [
    { type: 0, senderId: 2, cawonce: 1, text: 'hello' },
    { type: 0, senderId: 2, cawonce: 2, text: 'second' },
  ]);
  putBatch(c, 300, [
    { type: 1, senderId: 13, receiverId: 2, receiverCawonce: 1, cawonce: 1 },
    { type: 3, senderId: 13, receiverId: 2, receiverCawonce: 1, cawonce: 2 },
    { type: 7, senderId: 13, receiverId: 2, receiverCawonce: 1, cawonce: 3, recipients: [2], amounts: [500, 10], text: 'tip:2:1' },
  ]);
  await syncOnce(db, c, cfg);
  await refreshNames(db, c);
  while (indexCawTips(db) > 0) { /* backlog */ }
  // Interpreting OTHER bodies needs the statistics table, so the tip row is put in as indexOther would write it
  const tipSeq = db.prepare('SELECT seq FROM actions WHERE type = 7').get().seq;
  db.prepare("INSERT INTO other_parsed (seq, sender_id, kind, target_sender, target_cawonce, value) VALUES (?, 13, 'tip', 2, 1, '500')").run(tipSeq);
  return { db, api: makeApi(db, () => null), postTx };
}

test('Receipt: one post with its batch and the actions pointing at it', async () => {
  const { api, postTx } = await sample();
  const p = api('/api/posts/2/1', new URLSearchParams());
  assert.equal(p.status, undefined);   // the HTTP layer reads a top-level status as the response code
  assert.equal(p.post.text, 'hello');
  assert.equal(p.post.tx, postTx);
  assert.equal(p.post.block, 200);
  assert.deepEqual({ ...p.receipt, batchHash: typeof p.receipt.batchHash }, {
    logIndex: 1, contract: 'actions', kind: 'sig', validatorId: 9, batchHash: 'string',
    batchSize: 2, indexInBatch: 0, resolved: true, bodyBytes: 5,
  });
  assert.deepEqual(p.related.map((r) => r.kind).sort(), ['like', 'recaw', 'tip']);
  assert.equal(p.related.find((r) => r.kind === 'tip').value, '500');
  assert.equal(p.related[0].senderName, 'tentencaw');
  assert.equal(api('/api/posts/2/9', new URLSearchParams()).status, 404);
  assert.equal(api('/api/posts/13/1', new URLSearchParams()).status, 404);   // a LIKE, not a post
});

test('User search by name prefix and by token id; user post count', async () => {
  const { api } = await sample();
  const q = (s) => api('/api/users', new URLSearchParams({ q: s }));
  assert.deepEqual(q('tent').items.map((u) => u.id), [2, 13]);
  assert.deepEqual(q('@TENTENC').items.map((u) => u.id), [13]);
  assert.deepEqual(q('#13').items.map((u) => u.name), ['tentencaw']);
  assert.deepEqual(q('zzz').items, []);
  assert.equal(q('').status, 400);
  assert.equal(q('x'.repeat(33)).status, 400);
  assert.equal(api('/api/users/2', new URLSearchParams()).posts, 2);
});

test('Daily statistics count posts, actions, active accounts and tips', async () => {
  const { db, api } = await sample();
  // The fake chain's block times are in 2023, so look back far enough
  db.prepare('UPDATE batches SET block_time = ?').run(Math.floor(Date.now() / 1000) - 3600);
  const s = api('/api/stats', new URLSearchParams({ days: '7' }));
  assert.equal(s.timezone, 'UTC');
  assert.equal(s.daily.length, 1);
  assert.deepEqual({ ...s.daily[0], day: null }, { day: null, posts: 2, accepted: 5, notAccepted: 0, active: 2, tips: 1, tipTotal: '500' });
  assert.equal(s.byType.find((t) => t.typeName === 'CAW').count, 2);
  assert.equal(api('/api/stats', new URLSearchParams({ days: '0' })).status, 400);
  assert.equal(api('/api/stats', new URLSearchParams({ days: '366' })).status, 400);
});

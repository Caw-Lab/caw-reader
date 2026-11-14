// SPDX-License-Identifier: MIT
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOther, parsePoll, indexOther, makeStats } from '../src/other.mjs';
import { openDb } from '../src/db.mjs';
import { readBody } from '../src/smltxt.mjs';

const act = (o) => ({ sender_id: 3, receiver_id: 0, receiver_cawonce: 0, recipients: '[]', amounts: '[]', ...o });

test('hide:caw / hide:recaw forms', () => {
  assert.deepEqual(parseOther(act({}), 'hide:caw:22'), { kind: 'hide_caw', targetSender: 3, targetCawonce: 22, value: null });
  assert.deepEqual(parseOther(act({}), 'hide:recaw:1:16'), { kind: 'hide_recaw', targetSender: 1, targetCawonce: 16, value: null });
  assert.equal(parseOther(act({}), 'hide:caw:').kind, 'other');
  assert.equal(parseOther(act({}), 'hide:caw:99999999999').kind, 'other');   // exceeds uint32
  assert.equal(parseOther(act({}), 'hide:caw:1:2').kind, 'other');
});

test('tip:a:b only when a = receiverId, b = receiverCawonce and recipients = [receiverId]', () => {
  const ok = act({ receiver_id: 17, receiver_cawonce: 10, recipients: '[17]', amounts: '["35676758","1000"]' });
  assert.deepEqual(parseOther(ok, 'tip:17:10'), { kind: 'tip', targetSender: 17, targetCawonce: 10, value: '35676758' });
  assert.equal(parseOther(ok, 'tip:17:11').kind, 'other');                       // b in the body differs from receiverCawonce
  assert.equal(parseOther({ ...ok, recipients: '[3]' }, 'tip:17:10').kind, 'other'); // different recipient
  assert.equal(parseOther({ ...ok, recipients: '[17,18]', amounts: '["1","2","3"]' }, 'tip:17:10').kind, 'other');
});

test('tip: goes to the profile (only when receiverCawonce is 0)', () => {
  const ok = act({ receiver_id: 17, recipients: '[17]', amounts: '["163042328","1000"]' });
  assert.deepEqual(parseOther(ok, 'tip:'), { kind: 'tip_profile', targetSender: 17, targetCawonce: null, value: '163042328' });
  assert.equal(parseOther({ ...ok, receiver_cawonce: 5 }, 'tip:').kind, 'other');
});

test('vote and p: forms', () => {
  assert.deepEqual(parseOther(act({ receiver_id: 3, receiver_cawonce: 75 }), 'vote:1'), { kind: 'vote', targetSender: 3, targetCawonce: 75, value: '1' });
  assert.equal(parseOther(act({ receiver_id: 3, receiver_cawonce: 75 }), 'vote:').value, '');
  assert.deepEqual(parseOther(act({}), 'p:{"n":"Neumann","d":"Caw"}'), { kind: 'profile', targetSender: 3, targetCawonce: null, value: '{"n":"Neumann","d":"Caw"}' });
  assert.equal(parseOther(act({}), 'p:{"n":1}').kind, 'other');        // a value is not a string
  assert.equal(parseOther(act({}), 'p:{"n":"a"').kind, 'other');       // broken JSON
  assert.equal(parseOther(act({}), 'p:[1]').kind, 'other');
  assert.equal(parseOther(act({}), 'pi:307').kind, 'other');           // forms not checked are not interpreted
  assert.equal(parseOther(act({}), 'sp-i:10946454:6').kind, 'other');
});

test('Poll form', () => {
  assert.deepEqual(parsePoll('テストアンケート５\n::poll:選択肢A:選択肢B::::pd:1d::'), { options: ['選択肢A', '選択肢B'] });
  assert.deepEqual(parsePoll('::poll:びっとこCAW太郎:びっとこ売る太郎::::pd:1d::'), { options: ['びっとこCAW太郎', 'びっとこ売る太郎'] });
  assert.equal(parsePoll('ただの投稿'), null);
  assert.equal(parsePoll('::poll:A::'), null);     // only one option
  assert.equal(parsePoll('::poll:A:B'), null);     // not closed
});

test('qs: (71 bytes) / qx: (23 bytes) are recognised raw, before smltxt', () => {
  const qs = new Uint8Array(71); qs.set([0x71, 0x73, 0x3a]); qs[3] = 0xab;
  const qx = new Uint8Array(23); qx.set([0x71, 0x78, 0x3a]);
  const decodeAlways = () => new TextEncoder().encode('garbage');
  assert.equal(readBody(qs, decodeAlways).kind, 'session');
  assert.match(readBody(qs, decodeAlways).text, /^qs:ab0{134}$/);
  assert.equal(readBody(qx, decodeAlways).kind, 'session');
  const qs70 = qs.subarray(0, 70); // with a different length the contract does nothing -> no raw recognition either
  assert.notEqual(readBody(qs70, decodeAlways).kind, 'session');
});

test('Stats: latest like per account, tip totals, hide marks, latest vote per account', () => {
  const db = openDb(':memory:');
  db.exec("INSERT INTO batches (id, block_number, tx_hash, log_index, contract, kind, network_id, validator_id, action_count, batch_hash, resolved) VALUES (1, 1, '0x1', 0, 'actions', 'sig', 1, 9, 1, '0x0', 1)");
  const ins = db.prepare(`INSERT INTO actions (seq, batch_id, idx, status, type, sender_id, receiver_id, receiver_cawonce, network_id, cawonce, recipients, amounts, text)
    VALUES (?, 1, ?, 'accepted', ?, ?, ?, ?, 1, ?, ?, ?, ?)`);
  const enc = (s) => Uint8Array.from(new TextEncoder().encode(s));
  let seq = 0;
  const add = (type, s, r, rc, c, text = '', rec = '[]', am = '[]') => ins.run(++seq, seq, type, s, r, rc, c, rec, am, enc(text));
  add(0, 3, 0, 0, 75, 'Q\n::poll:A:B::::pd:1d::');   // post 3:75
  add(1, 5, 3, 75, 1);              // 5 likes
  add(1, 6, 3, 75, 1);              // 6 likes
  add(2, 6, 3, 75, 2);              // 6 unlikes
  add(1, 6, 3, 75, 3);              // 6 likes again
  add(2, 5, 3, 75, 4);              // 5 unlikes
  add(3, 7, 3, 75, 1);              // 7 RECAWs
  add(7, 8, 3, 75, 1, 'tip:3:75', '[3]', '["100","1000"]');
  add(7, 9, 3, 75, 1, 'tip:3:75', '[3]', '["250","1000"]');
  add(7, 3, 0, 0, 76, 'hide:caw:75');
  add(7, 5, 3, 75, 5, 'vote:0');
  add(7, 5, 3, 75, 6, 'vote:1');    // 5 votes again -> the latest, 1, is counted
  add(7, 6, 3, 75, 7, 'vote:1');
  add(7, 7, 3, 75, 2, 'vote:9');    // not an option
  add(7, 3, 0, 0, 77, 'p:{"n":"old","d":"x"}');
  add(7, 3, 0, 0, 78, 'p:{"n":"new"}');
  const identity = (b) => b;   // bodies are stored as plain UTF-8, so decoding passes them through
  assert.equal(indexOther(db, identity), 9);    // OTHER: tip 2, hide 1, vote 4, p 2
  assert.equal(indexOther(db, identity), 0);   // the second run continues (nothing left)
  const st = makeStats(db);
  const p = st.forPost(3, 75, 'Q\n::poll:A:B::::pd:1d::');
  assert.equal(p.likes, 1);          // only 6
  assert.equal(p.recaws, 1);
  assert.equal(p.tips, 2);
  assert.equal(p.tipTotal, '350');
  assert.equal(p.hidden, true);
  assert.deepEqual(p.poll, { options: [{ label: 'A', votes: 0 }, { label: 'B', votes: 2 }], otherVotes: 1 });
  assert.deepEqual(st.profile(3).fields, { n: 'new', d: 'x' });
  // someone else's hide:caw has no effect (only on the sender's own posts)
  assert.equal(st.forPost(5, 1, '').hidden, false);
});

test('Without the table, nothing is interpreted (and the position does not move)', () => {
  const db = openDb(':memory:');
  assert.equal(indexOther(db, null), 0);
});

test('Payments attached to a CAW are counted per recipient and become tips of that CAW', async () => {
  const { indexCawTips } = await import('../src/other.mjs');
  const db = openDb(':memory:');
  db.exec("INSERT INTO batches (id, block_number, tx_hash, log_index, contract, kind, network_id, validator_id, action_count, batch_hash, resolved) VALUES (1, 1, '0x1', 0, 'actions', 'sig', 1, 9, 1, '0x0', 1)");
  const ins = db.prepare(`INSERT INTO actions (seq, batch_id, idx, status, type, sender_id, receiver_id, receiver_cawonce, network_id, cawonce, recipients, amounts, text)
    VALUES (?, 1, ?, 'accepted', 0, ?, 17, 15, 1, ?, ?, ?, ?)`);
  const t = Uint8Array.from([0x41]);
  ins.run(1, 0, 17, 16, '[18,9]', '["36618201","36618201"]', t);     // to 2 accounts (no tip to the validator)
  ins.run(2, 1, 3, 139, '[17]', '["36618201","1000"]', t);           // to 1 account + validator
  ins.run(3, 2, 3, 141, '[17]', '["1","2","3"]', t);                 // counts do not fit -> not counted
  ins.run(4, 3, 3, 142, '[]', '[]', t);                              // no payment
  assert.equal(indexCawTips(db), 4);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM caw_tips').get().n, 3);
  const st = makeStats(db);
  assert.deepEqual([st.forPost(17, 16, 'A').tips, st.forPost(17, 16, 'A').tipTotal], [2, '73236402']);
  assert.deepEqual([st.forPost(3, 139, 'A').tips, st.forPost(3, 139, 'A').tipTotal], [1, '36618201']);
  assert.equal(st.forPost(3, 141, 'A').tips, 0);
  assert.equal(indexCawTips(db), 0);
});

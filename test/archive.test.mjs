// SPDX-License-Identifier: MIT
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AbiCoder, concat, getBytes, hexlify, keccak256, toBeHex, zeroPadValue } from 'ethers';
import { openDb } from '../src/db.mjs';
import { commitmentOf, foldChain, merkleRootOf, checkSubmission, compareWithDb, verifySubmission, sliceEnd, redactUrls, isTransient, withRetry, ZERO_HASH } from '../src/archive.mjs';
import { loadConfig } from '../src/config.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packActions, encodeAction } from './helpers.mjs';

const h32 = (n) => zeroPadValue(toBeHex(n), 32);

// ---- an independent, plain implementation used to build submissions for the tests ----
function buildSubmission({ startCp = 3, cps = 2, entryHash = h32(777) }) {
  const n = cps * 32;
  const list = [];
  for (let i = 0; i < n; i++) {
    list.push(i % 5 === 0
      ? { type: 0, senderId: 2 + (i % 3), cawonce: 100 + i, text: 'post ' + i }
      : i % 5 === 1 ? { type: 1, senderId: 9, receiverId: 2, receiverCawonce: 100 + i - 1, cawonce: 100 + i, recipients: [2], amounts: [2000n + BigInt(i)] }
        : { type: 4, senderId: 20 + i, receiverId: 2, cawonce: 1 });
  }
  const packed = hexlify(packActions(list));
  const r = list.map((_, i) => h32(5000 + i));
  let h = entryHash;
  const cpHashes = [];
  list.forEach((a, i) => {
    h = keccak256(concat([h, r[i], keccak256(encodeAction(a))]));
    if ((i + 1) % 32 === 0) cpHashes.push(h);
  });
  const coder = AbiCoder.defaultAbiCoder();
  let layer = cpHashes.map((x, i) => keccak256(keccak256(coder.encode(['uint256', 'bytes32'], [startCp + i, x]))));
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 === layer.length) next.push(layer[i]);
      else next.push(BigInt(layer[i]) < BigInt(layer[i + 1]) ? keccak256(concat([layer[i], layer[i + 1]])) : keccak256(concat([layer[i + 1], layer[i]])));
    }
    layer = next;
  }
  const merkleRoot = layer[0];
  const call = { packed, r, merkleRoot, entryHash };
  const sub = { id: 1, networkId: 1, merkleRoot, startCheckpointId: startCp, endCheckpointId: startCp + cps - 1, finalizedAt: 1, status: 0, dataCommitment: commitmentOf(packed, r, entryHash) };
  return { list, call, sub, cpHashes };
}

const failedNames = (res) => res.checks.filter((c) => c.ok === false).map((c) => c.name);

test('A correct submission passes every self check (3 checkpoints, odd Merkle layer)', () => {
  const s = buildSubmission({ startCp: 3, cps: 3 });
  const res = checkSubmission(s.sub, s.call);
  assert.deepEqual(failedNames(res), []);
  assert.equal(res.fold.cpHashes.length, 3);
  assert.deepEqual(res.fold.cpHashes, s.cpHashes);
  assert.equal(res.fold.actionHashes.length, 96);
});

test('sliceEnd follows the contract layout and reports short bytes as -1', () => {
  const a = encodeAction({ type: 4, senderId: 1, cawonce: 1, recipients: [5, 6], amounts: [1n, 2n, 3n], text: 'abc' });
  assert.equal(sliceEnd(a, 0), a.length);
  assert.equal(sliceEnd(a.subarray(0, a.length - 1), 0), -1);
  assert.equal(sliceEnd(a.subarray(0, 10), 0), -1);
});

test('merkleRootOf: one leaf, and the zero hash for none', () => {
  const x = h32(1);
  assert.equal(merkleRootOf(7, [x]), keccak256(keccak256(AbiCoder.defaultAbiCoder().encode(['uint256', 'bytes32'], [7, x]))));
  assert.equal(merkleRootOf(1, []), ZERO_HASH);
});

test('Tampering is detected', () => {
  const s = buildSubmission({ startCp: 3, cps: 2 });
  const flip = (hex, at) => { const b = getBytes(hex).slice(); b[at] ^= 1; return hexlify(b); };

  // one byte inside an action's text: the commitment, the rebuilt root both fail
  const t1 = { ...s.call, packed: flip(s.call.packed, 60) };
  assert.deepEqual(failedNames(checkSubmission(s.sub, t1)), ['data commitment', 'merkle root rebuilt']);

  // r values swapped
  const r2 = [...s.call.r]; [r2[0], r2[1]] = [r2[1], r2[0]];
  assert.ok(failedNames(checkSubmission(s.sub, { ...s.call, r: r2 })).includes('merkle root rebuilt'));

  // a different entryHash
  assert.ok(failedNames(checkSubmission(s.sub, { ...s.call, entryHash: h32(1) })).includes('data commitment'));

  // too few r values
  const short = checkSubmission({ ...s.sub, dataCommitment: commitmentOf(s.call.packed, s.call.r.slice(1), s.call.entryHash) }, { ...s.call, r: s.call.r.slice(1) });
  assert.ok(failedNames(short).includes('shape'));

  // extra bytes after the last action
  const extra = hexlify(concat([s.call.packed, '0x00']));
  const t4 = checkSubmission({ ...s.sub, dataCommitment: commitmentOf(extra, s.call.r, s.call.entryHash) }, { ...s.call, packed: extra });
  assert.ok(failedNames(t4).includes('shape'));

  // the call's root differs from the stored one
  assert.ok(failedNames(checkSubmission(s.sub, { ...s.call, merkleRoot: h32(9) })).includes('merkle root argument'));

  // the submission claims a wider range than the calldata holds
  assert.ok(failedNames(checkSubmission({ ...s.sub, endCheckpointId: s.sub.endCheckpointId + 1 }, s.call)).includes('shape'));
});

// ---- the data of a real submission (CawActionsArchive on Arbitrum Sepolia, submission 15, checkpoint 49) ----
const fx = JSON.parse(readFileSync(new URL('./fixtures/archive-submission-15.json', import.meta.url), 'utf8'));

test('Real submission 15: every self check passes, and the hashes equal those of the source chain', () => {
  const res = checkSubmission(fx.submission, fx.call);
  assert.deepEqual(failedNames(res), []);
  assert.equal(res.expected, 32);
  // checkpointHashes[0] is checkpoint 48 (the entry hash), then 49
  assert.equal(fx.call.entryHash, fx.checkpointHashes[0]);
  assert.deepEqual(res.fold.cpHashes, fx.checkpointHashes.slice(1));
});

test('Real submission 15: one changed byte is detected', () => {
  const b = getBytes(fx.call.packed).slice();
  b[b.length - 1] ^= 1;
  assert.ok(failedNames(checkSubmission(fx.submission, { ...fx.call, packed: hexlify(b) })).includes('merkle root rebuilt'));
});

// ---- the whole verification with a fake source, and the comparison with this reader's data ----
function fakeSource(s, hashes) {
  return {
    async submitCall() { return { tx: '0xaa', block: 1, ...s.call }; },
    async checkpointHash(net, cp) { return hashes.get(cp) ?? ZERO_HASH; },
  };
}

function dbWith(list, extra = []) {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO batches (id, block_number, tx_hash, log_index, contract, kind, network_id, validator_id, action_count, batch_hash, resolved) VALUES (1, 1, '0x1', 0, 'actions', 'sig', 1, 9, 1, '0x', 1)").run();
  const ins = db.prepare(`INSERT INTO actions (seq, batch_id, idx, status, type, sender_id, receiver_id, receiver_cawonce, network_id, cawonce, recipients, amounts, text)
    VALUES (?,1,?,?,?,?,?,?,?,?,?,?,?)`);
  let seq = 1;
  for (const [status, a] of [...list.map((x) => ['accepted', x]), ...extra]) {
    ins.run(seq, seq, status, a.type ?? 0, a.senderId, a.receiverId ?? 0, a.receiverCawonce ?? 0, a.networkId ?? 1, a.cawonce,
      JSON.stringify(a.recipients ?? []), JSON.stringify((a.amounts ?? []).map(String)), typeof a.text === 'string' ? new TextEncoder().encode(a.text) : (a.text ?? new Uint8Array()));
    seq++;
  }
  return db;
}

test('verifySubmission: all checks, including the checkpoint hashes and the entry hash', async () => {
  const s = buildSubmission({ startCp: 3, cps: 2 });
  const hashes = new Map([[2, s.call.entryHash], [3, s.cpHashes[0]], [4, s.cpHashes[1]]]);
  const r = await verifySubmission(fakeSource(s, hashes), s.sub, dbWith(s.list));
  assert.equal(r.ok, true);
  assert.deepEqual(r.checks.map((c) => c.ok), [true, true, true, true, true, true, true]);
  assert.equal(r.comparison.matched, 64);

  // a checkpoint hash that differs on the source chain
  const bad = new Map(hashes); bad.set(4, h32(1));
  const r2 = await verifySubmission(fakeSource(s, bad), s.sub, null);
  assert.equal(r2.ok, false);
  assert.deepEqual(failedNames(r2), ['checkpoint hashes']);
  assert.equal(r2.checks.at(-1).ok, null); // no database: not checked, not a failure

  // a submission from checkpoint 1 starts from the zero hash
  const s1 = buildSubmission({ startCp: 1, cps: 1, entryHash: ZERO_HASH });
  const r3 = await verifySubmission(fakeSource(s1, new Map([[1, s1.cpHashes[0]]])), s1.sub, null);
  assert.equal(r3.ok, true);
});

test('Comparison with the database: equal, differing, not read yet', () => {
  const s = buildSubmission({ startCp: 3, cps: 1 });
  const tampered = s.list.map((a, i) => (i === 4 ? { ...a, cawonce: a.cawonce } : a));
  tampered[0] = { ...tampered[0], text: 'changed' };            // a different body
  tampered[2] = { ...tampered[2], receiverId: 77 };             // a different receiver
  const rows = tampered.slice(0, 30);                            // the last two actions are not in the DB yet
  const c = compareWithDb(dbWith(rows), s.call.packed);
  assert.equal(c.total, 32);
  assert.equal(c.matched, 28);
  assert.deepEqual(c.mismatched.map((m) => m.fields), [['text'], ['receiver_id']]);
  assert.equal(c.notInDb.length, 2);
  assert.equal(c.ambiguous.length, 0);
});

test('Ambiguous rows are reported on their own, with the candidate the archive equals', () => {
  const s = buildSubmission({ startCp: 3, cps: 1 });
  // action 0 has two candidate rows with the same (sender, cawonce): the archive carries the first
  const a0 = s.list[0];
  const other = { ...a0, text: 'the other one' };
  const rows = s.list.slice(1);
  const db = dbWith(rows, [['ambiguous', a0], ['ambiguous', other]]);
  const c = compareWithDb(db, s.call.packed);
  assert.equal(c.mismatched.length, 0);
  assert.equal(c.notInDb.length, 0);
  assert.equal(c.matched, 31);
  assert.equal(c.ambiguous.length, 1);
  assert.equal(c.ambiguous[0].candidates, 2);
  assert.deepEqual(c.ambiguous[0].equal, [32]);           // seq of the first ambiguous row

  // when the archive equals none of the candidates, it says so
  const db2 = dbWith(rows, [['ambiguous', { ...a0, text: 'x' }], ['ambiguous', { ...a0, text: 'y' }]]);
  assert.deepEqual(compareWithDb(db2, s.call.packed).ambiguous[0].equal, []);
});

test('Skipped and rejected rows are not accepted actions: the action counts as not read', () => {
  const s = buildSubmission({ startCp: 3, cps: 1 });
  const db = dbWith(s.list.slice(1), [['skipped', s.list[0]]]);
  const c = compareWithDb(db, s.call.packed);
  assert.equal(c.notInDb.length, 1);
  assert.equal(c.mismatched.length, 0);
});

test('An empty database is "not checked", not a pass', async () => {
  const s = buildSubmission({ startCp: 3, cps: 1 });
  const hashes = new Map([[2, s.call.entryHash], [3, s.cpHashes[0]]]);
  const r = await verifySubmission(fakeSource(s, hashes), s.sub, dbWith([]));
  const last = r.checks.at(-1);
  assert.equal(last.ok, null);
  assert.match(last.detail, /NOT CHECKED/);
  assert.equal(r.ok, true); // the checks against the chain still passed
});

test('redactUrls keeps only the origin of every URL', () => {
  const t = redactUrls('failed: https://arb.example.com/v2/SECRETKEY123?apikey=abc and http://x.test:8545/path, done');
  assert.equal(t, 'failed: https://arb.example.com/**** and http://x.test:8545/****, done');
  assert.ok(!t.includes('SECRET') && !t.includes('apikey'));
});

test('withRetry retries rate limits and timeouts, not other errors', async () => {
  const waits = [];
  const sleepFn = async (ms) => waits.push(ms);
  let n = 0;
  const v = await withRetry(async () => { if (++n < 3) throw new Error('HTTP 429 Too Many Requests'); return 'ok'; }, { sleepFn });
  assert.equal(v, 'ok');
  assert.deepEqual(waits, [1000, 2000]);

  let m = 0;
  await assert.rejects(withRetry(async () => { m++; throw new Error('execution reverted'); }, { sleepFn }), /reverted/);
  assert.equal(m, 1);

  let k = 0;
  await assert.rejects(withRetry(async () => { k++; throw new Error('No response from RPC (x, 30 s)'); }, { tries: 3, sleepFn }), /No response/);
  assert.equal(k, 3);
  assert.equal(isTransient(new Error('rate limit exceeded')), true);
  assert.equal(isTransient(new Error('bad data')), false);
});

// ---- the config key and the command ----
const tmp = mkdtempSync(join(tmpdir(), 'caw-archive-'));
const baseCfg = { cawActions: '0x73246104f57001EDC6d0659Fa37Afb672a76E763', ledger: '0x93593A023629EB84B389770d76A81C5f982F02a9' };
const writeCfg = (name, extra) => { const f = join(tmp, name); writeFileSync(f, JSON.stringify({ ...baseCfg, ...extra })); return f; };

test('Config: cawArchive is optional, defaults the chain id, and is validated', async () => {
  assert.equal((await loadConfig(writeCfg('a.json', {}))).cawArchive, null);
  const ok = await loadConfig(writeCfg('b.json', { cawArchive: { rpcUrl: 'https://rpc.example', address: '0x3B526a24a740F8FD5Ed9688E109414Ec10786B8D' } }));
  assert.equal(ok.cawArchive.chainId, 421614);
  assert.equal(ok.archiveRpcUrl, null);   // a different thing
  await assert.rejects(loadConfig(writeCfg('c.json', { cawArchive: { rpcUrl: 'https://rpc.example' } })), /cawArchive.address/);
  await assert.rejects(loadConfig(writeCfg('d.json', { cawArchive: { rpcUrl: 'https://rpc.example', address: 'nope' } })), /cawArchive.address/);
  await assert.rejects(loadConfig(writeCfg('e.json', { cawArchive: { rpcUrl: 'ftp://rpc.example', address: '0x3B526a24a740F8FD5Ed9688E109414Ec10786B8D' } })), /cawArchive.rpcUrl/);
  await assert.rejects(loadConfig(writeCfg('f.json', { cawArchive: { rpcUrl: '', address: '0x3B526a24a740F8FD5Ed9688E109414Ec10786B8D' } })), /cawArchive.rpcUrl/);
});

test('Command: archive-check without cawArchive, or with a bad --submission, stops with exit code 1 and no network', () => {
  const run = (cfgFile, ...more) => spawnSync(process.execPath, ['--no-warnings', 'bin/caw-reader.mjs', 'archive-check', '--config', cfgFile, ...more], { encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname });
  const noArchive = run(writeCfg('g.json', {}));
  assert.equal(noArchive.status, 1);
  assert.match(noArchive.stderr, /cawArchive/);
  const bad = run(writeCfg('h.json', { cawArchive: { rpcUrl: 'http://127.0.0.1:9', address: '0x3B526a24a740F8FD5Ed9688E109414Ec10786B8D' } }), '--submission', 'x');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--submission/);
});

test('Command: an unreachable RPC is reported without the URL path and ends with exit code 1', () => {
  const f = writeCfg('i.json', { cawArchive: { rpcUrl: 'http://127.0.0.1:9/SECRETKEY999', address: '0x3B526a24a740F8FD5Ed9688E109414Ec10786B8D' }, db: join(tmp, 'none.sqlite') });
  const r = spawnSync(process.execPath, ['--no-warnings', 'bin/caw-reader.mjs', 'archive-check', '--config', f], { encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname, timeout: 120000 });
  assert.equal(r.status, 1);
  assert.ok(!(r.stdout + r.stderr).includes('SECRETKEY999'));
  rmSync(tmp, { recursive: true, force: true });
});

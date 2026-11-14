// SPDX-License-Identifier: MIT
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePacked, findPackedForBatch, findErc1271Group, decodeErc1271Groups, abiBytesCandidates } from '../src/decode.mjs';
import { packActions, packErc1271Groups, encodeAction, CALLS, ADDR, getBytes, keccak256 } from './helpers.mjs';

const sample = [
  { type: 0, senderId: 2, cawonce: 7, text: 'hello' },
  { type: 1, senderId: 13, receiverId: 2, receiverCawonce: 7, cawonce: 300, recipients: [2], amounts: [2000n] },
  { type: 4, senderId: 13, receiverId: 2, cawonce: 301, recipients: [5, 6], amounts: [1n, 2n, 3n] },
];

test('packedActions round-trips (every field, payments, tips)', () => {
  const d = decodePacked(packActions(sample));
  assert.equal(d.count, 3);
  assert.equal(d.trailing, 0);
  assert.equal(d.actions[0].typeName, 'CAW');
  assert.equal(new TextDecoder().decode(d.actions[0].text), 'hello');
  assert.deepEqual([d.actions[1].senderId, d.actions[1].receiverId, d.actions[1].receiverCawonce, d.actions[1].cawonce], [13, 2, 7, 300]);
  assert.deepEqual(d.actions[2].recipients, [5, 6]);
  assert.deepEqual(d.actions[2].amounts, [1n, 2n, 3n]);
  // Each action's raw equals that action built on its own
  assert.deepEqual([...d.actions[1].raw], [...encodeAction(sample[1])]);
});

test('Reads the maximum cawonce and senderId without loss', () => {
  const d = decodePacked(packActions([{ senderId: 0xffffffff, cawonce: 0xffffffff, amounts: [0xffffffffffffffffn], recipients: [] }]));
  assert.equal(d.actions[0].senderId, 0xffffffff);
  assert.equal(d.actions[0].cawonce, 0xffffffff);
  assert.equal(d.actions[0].amounts[0], 0xffffffffffffffffn);
});

test('Truncated packedActions throws; trailing bytes are counted', () => {
  const p = packActions(sample);
  assert.throws(() => decodePacked(p.subarray(0, p.length - 1)), /truncated/);
  const extra = new Uint8Array(p.length + 3); extra.set(p);
  assert.equal(decodePacked(extra).trailing, 3);
});

test('Extracts by batchHash from the calldata of a direct call', () => {
  const p = packActions(sample);
  const data = getBytes(CALLS.encodeFunctionData('processActions', [9, p, '0x' + '11'.repeat(67), 0, 0]));
  const got = findPackedForBatch(data, keccak256(p), 3).found;
  assert.deepEqual([...got], [...p]);
});

test('Also extracts from nested calldata through another contract', () => {
  const p = packActions(sample);
  const inner = CALLS.encodeFunctionData('safeProcessActions', [9, p, '0x', 0, 0]);
  const outer = getBytes(CALLS.encodeFunctionData('execute', [ADDR.actions, 0, inner]));
  assert.deepEqual([...findPackedForBatch(outer, keccak256(p), 3).found], [...p]);
});

test('Does not extract when the hash or count differs (no mistakes for look-alikes)', () => {
  const p = packActions(sample);
  const data = getBytes(CALLS.encodeFunctionData('processActions', [9, p, '0x', 0, 0]));
  assert.equal(findPackedForBatch(data, keccak256(packActions(sample.slice(0, 2))), 2).found, null);
  assert.equal(findPackedForBatch(data, keccak256(p), 2).found, null);
});

test('ERC1271 path: extracts by the per-group batchHash (the part without groupSize)', () => {
  const g1 = [sample[0]];
  const g2 = [sample[1], sample[2]];
  const packed = packErc1271Groups([g1, g2]);
  assert.equal(decodeErc1271Groups(packed).length, 2);
  const data = getBytes(CALLS.encodeFunctionData('processActionsERC1271', [9, packed, ['0x01', '0x02'], [keccak256('0x01'), keccak256('0x02')], 0, 0]));
  const g2bytes = packed.subarray(2 + encodeAction(sample[0]).length + 2);
  const hit = findErc1271Group(data, keccak256(g2bytes), 2).found;
  assert.ok(hit);
  assert.equal(hit.actions.length, 2);
  assert.equal(hit.actions[0].cawonce, 300);
  // A different count does not match
  assert.equal(findErc1271Group(data, keccak256(g2bytes), 1).found, null);
});

test('With crafted huge calldata, the search stops at its limit', () => {
  // Calldata packed with 400 candidates of 100,000 bytes that look like "length word + count 3" (about 40 MB of hashing)
  const len = 100000;
  const unit = new Uint8Array(32 + len);
  unit[29] = (len >> 16) & 0xff; unit[30] = (len >> 8) & 0xff; unit[31] = len & 0xff;
  unit[32] = 0; unit[33] = 3;
  const data = new Uint8Array(unit.length * 400);
  for (let i = 0; i < 400; i++) data.set(unit, i * unit.length);
  const t0 = Date.now();
  const r = findPackedForBatch(data, '0x' + '00'.repeat(32), 3);
  assert.equal(r.found, null);
  assert.equal(r.exhausted, true);
  assert.ok(Date.now() - t0 < 5000);
});

test('A "length" above the limit is not a candidate', () => {
  const big = new Uint8Array(32 + 200000);
  big[29] = (200000 >> 16) & 0xff; big[30] = (200000 >> 8) & 0xff; big[31] = 200000 & 0xff;
  assert.equal([...abiBytesCandidates(big)].length, 0);
});

// SPDX-License-Identifier: MIT
//
// The 12 smltxt test vectors (spec memo section "smltxt test vectors (observed)").
// The statistics table is not in this repository, so pass the path of upstream tableData.ts in CAW_TABLE_FILE.
// Without it, the tests that need the table are skipped.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { getBytes } from 'ethers';
import { tableFromSource, smlMakeDecoder, readBody } from '../src/smltxt.mjs';

const SHA = '3b1111b5c9e2dbc249f93f1bd46cc2ce8d663e44cefc585a9288632fff024e30';
const file = process.env.CAW_TABLE_FILE;
const have = file && existsSync(file);

const VECTORS = [
  ['a', '0x4760'],
  ['z', '0x37d0'],
  ['aa', '0x4758a0'],
  ['test', '0x2519d8'],
  ['Test', '0x1259d8'],
  ['test test', '0x2519d2f5d8'],
  ['hello world', '0xbdd5f39c115c'],
  ['https://tencawffee.com/s/knTDbd', '0xbdffcbfe0866d79f7d17caad88eb617622fc74a7'],
  ['あ', '0xf84c'],
  ['漢', '0xcd6eb2'],
  ['👍', '0xdabbd848'],
  ['ギルさん起きてwakeup(test)', '0xf4b9fdc77c35f4eaeb0624f809f15ef5cbce2a4e43e796edb1'],
];

test('All 12 test vectors decode back to the original bodies', { skip: !have && 'skipped because CAW_TABLE_FILE is not set' }, () => {
  const decode = smlMakeDecoder(tableFromSource(readFileSync(file, 'utf8'), SHA));
  for (const [text, hex] of VECTORS) {
    assert.equal(new TextDecoder().decode(decode(getBytes(hex))), text, hex);
    assert.deepEqual(readBody(getBytes(hex), decode), { kind: 'sml', text });
  }
  // An empty body is 0x80; input whose last byte is 0 is rejected
  assert.equal(decode(Uint8Array.from([0x80])).length, 0);
  assert.throws(() => decode(Uint8Array.from([0x47, 0x00])), /last byte is 0/);
});

test('A table with a different SHA-256 is not used', () => {
  const fake = 'export const T = "' + 'A'.repeat(519168) + '";';
  assert.throws(() => tableFromSource(fake, SHA), /SHA-256 of the statistics table does not match/);
  assert.throws(() => tableFromSource('const x = 1;', SHA), /does not have the expected shape/);
});

test('Without the table: UTF-8, or else the bytes as they are', () => {
  assert.deepEqual(readBody(new TextEncoder().encode('こんにちは'), null), { kind: 'utf8', text: 'こんにちは' });
  assert.deepEqual(readBody(Uint8Array.from([0xff, 0xfe]), null), { kind: 'binary', text: null });
  assert.deepEqual(readBody(new Uint8Array(0), null), { kind: 'empty', text: '' });
});

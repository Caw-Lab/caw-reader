// SPDX-License-Identifier: MIT
// The Quick Sign text rules in public/sign.js. Every case below was also run through
// SessionMessageParser.sol (GilgameshCaw/Caw master 97cd13f, compiled with solc 0.8.24 and executed
// in an EVM) on 2026-11-18; the expected results are what the contract returned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = { window: {} };
vm.runInNewContext(readFileSync(new URL('../public/sign.js', import.meta.url), 'utf8'), ctx);
const parse = (msg) => ctx.window.CawSign._parseQuickSign(msg, 'en');

const K = '0x1111111111111111111111111111111111111111';
const D = '17 December 2026 00:00:00 UTC';
const L = (spend, tip, date = D, key = K, o = {}) => {
  const lines = [o.head ?? 'Enable Quick Sign', '------------------', 'Spend limit:', spend, '', 'Tip per action:', tip, '', 'Expires:', date, '', 'CAW Key:', key];
  if (o.drop) lines.pop();
  return lines.join(o.sep ?? '\n');
};
const ok = (spend, tip, expiry, key = K) => ({ spend, tip, expiry, key });

const CASES = [
  ['5M CAW', L('5M CAW', '1000 CAW'), ok(5000000n, 1000n, 1797465600)],
  ['No limit', L('No limit', '1000 CAW'), null],
  ['0M', L('0M CAW', '1000 CAW'), null],
  ['space before M', L('5 M CAW', '1000 CAW'), null],
  ['nothing checked after M', L('5Mxxx', '1000 CAW'), ok(5000000n, 1000n, 1797465600)],
  ['999B', L('999B CAW', '1000 CAW'), ok(999000000000n, 1000n, 1797465600)],
  ['tip with a note', L('5M CAW', '1M CAW (~$0.0010)'), ok(5000000n, 1000000n, 1797465600)],
  ['tip with an empty note', L('5M CAW', '1000 CAW ()'), ok(5000000n, 1000n, 1797465600)],
  ['tip 0', L('5M CAW', '0 CAW'), ok(5000000n, 0n, 1797465600)],
  ['tip without a number', L('5M CAW', ' CAW!'), null],
  ['tip note not closed', L('5M CAW', '1000 CAW (x'), null],
  ['29 Feb in a leap year', L('5M CAW', '1000 CAW', '29 February 2028 12:34:56 UTC'), ok(5000000n, 1000n, 1835440496)],
  ['29 Feb in a common year', L('5M CAW', '1000 CAW', '29 February 2027 00:00:00 UTC'), null],
  ['short month name', L('5M CAW', '1000 CAW', '1 Jan 2027 00:00:00 UTC'), null],
  ['hour 24', L('5M CAW', '1000 CAW', '1 March 2027 24:00:00 UTC'), null],
  ['day with leading zeros', L('5M CAW', '1000 CAW', '007 March 2027 01:02:03 UTC'), ok(5000000n, 1000n, 1804381323)],
  ['zone not checked', L('5M CAW', '1000 CAW', '7 March 2027 01:02:03 XYZ'), ok(5000000n, 1000n, 1804381323)],
  ['first two key characters not checked', L('5M CAW', '1000 CAW', D, 'zz1111111111111111111111111111111111111111'), ok(5000000n, 1000n, 1797465600)],
  ['short key', L('5M CAW', '1000 CAW', D, '0x11111'), null],
  ['key not hex', L('5M CAW', '1000 CAW', D, '0x111111111111111111111111111111111111111g'), null],
  ['12 lines', L('5M CAW', '1000 CAW', D, K, { drop: true }), null],
  ['CRLF line ends', L('5M CAW', '1000 CAW', D, K, { sep: '\r\n' }), null],
  ['first line differs', L('5M CAW', '1000 CAW', D, K, { head: 'Enable Quick sign' }), null],
  ['year 2201', L('5M CAW', '1000 CAW', '1 March 2201 00:00:00 UTC'), null],
];

for (const [name, msg, want] of CASES) {
  test('Quick Sign text, same as the contract: ' + name, () => {
    const r = parse(msg);
    if (want == null) { assert.ok(r.fail, 'rejected'); return; }
    assert.ok(r.ok, 'accepted');
    assert.deepEqual({ spend: r.spendLimit, tip: r.tip, expiry: r.expiry, key: r.key }, want);
  });
}

#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Observes the bodies of OTHER actions (actionType 7) using only the DB contents read from the chain.
// The upstream client code is not used as a reference (clean room). It only outputs material for working out
// the forms; it does not interpret them.
//
// Usage: node bin/inspect-other.mjs [--config config.json]
//   Prints counts per prefix and writes one line per action to other-actions.tsv.

import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../src/config.mjs';
import { loadTable, smlMakeDecoder } from '../src/smltxt.mjs';

const ci = process.argv.indexOf('--config');
const cfg = await loadConfig(ci >= 0 ? process.argv[ci + 1] : 'config.json');
let decode = null;
try { decode = smlMakeDecoder(await loadTable(cfg)); } catch (e) { console.log('Cannot use the statistics table: ' + e.message); }
const db = new DatabaseSync(cfg.db, { readOnly: true });

const rows = db.prepare(`SELECT a.sender_id, a.cawonce, a.receiver_id, a.recipients, a.amounts, a.text, b.block_number
  FROM actions a JOIN batches b ON b.id = a.batch_id
  WHERE a.type = 7 AND a.status = 'accepted' ORDER BY a.seq`).all();

const hex = (u) => Buffer.from(u).toString('hex');
const counts = new Map();
const add = (k) => counts.set(k, (counts.get(k) || 0) + 1);
const out = [['block', 'senderId', 'cawonce', 'receiverId', 'recipients', 'amounts', 'bytes', 'raw_head_hex', 'how', 'prefix', 'text'].join('\t')];

for (const r of rows) {
  const raw = new Uint8Array(r.text);
  const head3 = Buffer.from(raw.subarray(0, 3)).toString('latin1');
  let how, prefix, text;
  if (head3 === 'qs:' || head3 === 'qx:') {
    // Forms the contract reads as raw bytes (CawActions.sol:1452-1489)
    how = 'raw';
    prefix = head3 + (head3 === 'qs:' ? (raw.length === 71 ? '(71B)' : '(wrong length ' + raw.length + 'B)') : (raw.length === 23 ? '(23B)' : '(wrong length ' + raw.length + 'B)'));
    text = hex(raw.subarray(3));
  } else {
    let s = null;
    if (decode) { try { s = new TextDecoder('utf-8', { fatal: true }).decode(decode(raw)); how = 'sml'; } catch { /* fall through */ } }
    if (s == null) { try { s = new TextDecoder('utf-8', { fatal: true }).decode(raw); how = 'utf8'; } catch { /* fall through */ } }
    if (s == null) { how = 'binary'; prefix = '(cannot decode)'; text = hex(raw); }
    else { text = s; const m = s.match(/^[A-Za-z0-9_-]{1,12}:/); prefix = m ? m[0] : '(no prefix)'; }
  }
  add(how + ' ' + prefix);
  out.push([r.block_number, r.sender_id, r.cawonce, r.receiver_id, r.recipients, r.amounts, raw.length, hex(raw.subarray(0, 8)), how, prefix,
    JSON.stringify(text).slice(0, 400)].join('\t'));
}

console.log('OTHER actions (accepted): ' + rows.length);
for (const [k, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log('  ' + String(n).padStart(4) + '  ' + k);
writeFileSync('other-actions.tsv', '﻿' + out.join('\n') + '\n');
console.log('One line per action: other-actions.tsv');

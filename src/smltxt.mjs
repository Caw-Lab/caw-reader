// SPDX-License-Identifier: MIT
//
// Decoding of the post body compression format (smltxt).
// Carried over unchanged from the <smltxt> part of the read-only viewer prototype v0, which was written
// only from the text of the spec memo section "smltxt format" -> "Write-up results".
// The upstream smltxt code was not used as a reference (clean room).
// The statistics table is not included in this repository. It is loaded at run time from the upstream
// public repository (pinned commit) and used only when its SHA-256 matches
// (spec memo section "Open issue: handling the statistics table").

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const SML_STATES = 39 * 39;               // 1,521 states
export const SML_TABLE_BYTES = SML_STATES * 256; // 389,376 bytes

// Class number of the preceding byte (0-38)
export function smlClass(b) {
  if (b >= 0x41 && b <= 0x5A) return b - 0x40;        // A-Z -> 1-26
  if (b >= 0x61 && b <= 0x7A) return b - 0x60;        // a-z -> 1-26
  if (b === 0x20) return 27;                          // space
  if (b >= 0x30 && b <= 0x39) return 28 + (b - 0x30); // 0-9 -> 28-37
  if (b >= 0x21 && b <= 0x7E) return 38;              // other printable ASCII
  return 0;                                           // newline, tab, DEL, non-ASCII, etc.
}

// Stored value v (0-255) to weight: natural log, then exp, rounded to the nearest integer (halves go up)
const SML_COEF = Math.log(1000000000 / 10) * (1 / 255);
function smlWeight(v) { return Math.round(Math.exp(v * SML_COEF) * 10); }

// Builds the Huffman tree of one state from its 256 weights.
// Leaves in ascending byte order -> stable sort by ascending weight -> join the two smallest (first is left,
// second is right) into a parent, append it at the end, and stable-sort again.
function smlBuildTree(weights) {
  let nodes = [];
  for (let b = 0; b < weights.length; b++) nodes.push({ w: weights[b], sym: b });
  nodes.sort((x, y) => x.w - y.w);
  while (nodes.length > 1) {
    const left = nodes.shift();
    const right = nodes.shift();
    nodes.push({ w: left.w + right.w, left, right });
    nodes.sort((x, y) => x.w - y.w);
  }
  return nodes[0];
}

export function smlMakeDecoder(table) {
  if (!(table instanceof Uint8Array) || table.length !== SML_TABLE_BYTES) throw new Error('The statistics table has the wrong size');
  const trees = new Array(SML_STATES);
  const treeOf = (state) => {
    if (!trees[state]) {
      const ws = new Array(256);
      for (let b = 0; b < 256; b++) ws[b] = smlWeight(table[state * 256 + b]);
      trees[state] = smlBuildTree(ws);
    }
    return trees[state];
  };
  // compressed bytes -> UTF-8 bytes
  return function decode(bytes) {
    if (bytes.length === 0) return new Uint8Array(0);
    const last = bytes[bytes.length - 1];
    if (last === 0) throw new Error('The last byte is 0 (no terminating 1)');
    let trailingZeros = 0;
    while (((last >> trailingZeros) & 1) === 0) trailingZeros++;
    const validBits = bytes.length * 8 - trailingZeros - 1;  // drop the padding zeros and the terminating 1
    const out = [];
    let state = 0, node = treeOf(0), i = 0;
    while (i < validBits) {
      const bit = (bytes[i >> 3] >> (7 - (i & 7))) & 1;  // from the high bit of each byte
      node = bit ? node.right : node.left;              // left is 0, right is 1
      i++;
      if (node.sym !== undefined) {
        out.push(node.sym);
        state = (state % 39) * 39 + smlClass(node.sym);
        node = treeOf(state);
      }
    }
    if (node !== treeOf(state)) throw new Error('Ran out of bits in the middle of a code');
    return Uint8Array.from(out);
  };
}

// Extracts the table from the text of upstream tableData.ts and checks its SHA-256.
// The expected shape is the same as in the viewer: exactly one base64 run of 1000 characters or more.
export function tableFromSource(text, expectedSha256) {
  const runs = text.match(/[A-Za-z0-9+/]{1000,}={0,2}/g) || [];
  if (runs.length !== 1) throw new Error('The statistics table file does not have the expected shape');
  const table = new Uint8Array(Buffer.from(runs[0], 'base64'));
  const hex = createHash('sha256').update(table).digest('hex');
  if (hex !== String(expectedSha256).trim().toLowerCase()) {
    throw new Error('The SHA-256 of the statistics table does not match (' + hex.slice(0, 12) + '...)');
  }
  return table;
}

// Loads the statistics table as configured: from tableFile if set, otherwise from tableUrl.
export async function loadTable({ tableFile, tableUrl, tableSha256 }) {
  let text;
  if (tableFile) {
    text = await readFile(tableFile, 'utf8');
  } else {
    const res = await fetch(tableUrl, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error('Failed to fetch the statistics table (HTTP ' + res.status + ')');
    text = await res.text();
  }
  return tableFromSource(text, tableSha256);
}

// Reads a body: decode as smltxt if the table is available, else as UTF-8, else keep the bytes.
// (Same order as bodyText in the viewer)
export function readBody(bytes, decode) {
  if (bytes.length === 0) return { kind: 'empty', text: '' };
  // qs: (71 bytes) and qx: (23 bytes) are read by the contract as raw, uncompressed bytes (CawActions.sol:1452-1489)
  if (bytes[0] === 0x71 && bytes[2] === 0x3a && ((bytes[1] === 0x73 && bytes.length === 71) || (bytes[1] === 0x78 && bytes.length === 23))) {
    return { kind: 'session', text: (bytes[1] === 0x73 ? 'qs:' : 'qx:') + Buffer.from(bytes.subarray(3)).toString('hex') };
  }
  if (decode) {
    try { return { kind: 'sml', text: new TextDecoder().decode(decode(bytes)) }; } catch { /* fall through */ }
  }
  try {
    return { kind: 'utf8', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { kind: 'binary', text: null };
  }
}

#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Usage:
//   node bin/caw-reader.mjs find-start [--config config.json]   find the CawActions deployment block (a startBlock candidate)
//   node bin/caw-reader.mjs sync       [--config config.json]   read up to the current head and exit
//   node bin/caw-reader.mjs run        [--config config.json]   keep reading and serve the UI and API
//   node bin/caw-reader.mjs serve      [--config config.json]   serve the UI and API without reading
//   node bin/caw-reader.mjs status     [--config config.json]   show the DB state
//   node bin/caw-reader.mjs diagnose   [--config config.json]   measure raw eth_getLogs responses of the RPC at several range widths

import { loadConfig, fingerprint } from '../src/config.mjs';
import { openDb, checkFingerprint, getMeta } from '../src/db.mjs';
import { makeChain, describeError } from '../src/rpc.mjs';
import { syncOnce, refreshNames, refreshL1Names, runLoop, EVENTS } from '../src/sync.mjs';
import { startServer } from '../src/server.mjs';
import { loadTable, smlMakeDecoder } from '../src/smltxt.mjs';

const args = process.argv.slice(2);
const cmd = args[0];
const ci = args.indexOf('--config');
const configPath = ci >= 0 ? args[ci + 1] : 'config.json';

function usage() {
  console.log('Usage: node bin/caw-reader.mjs <find-start|sync|run|serve|status|diagnose> [--config config.json]');
  process.exit(2);
}

// Do not print an API key contained in a URL (mask the last path segment and the query)
function hideKey(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/');
    if (parts.length > 1 && parts[parts.length - 1].length >= 8) parts[parts.length - 1] = '****';
    return u.origin + parts.join('/') + (u.search ? '?****' : '');
  } catch { return '(not a URL)'; }
}

// Called after each range. Prints progress for every range with actions, and at most every 10 s for ranges without
function progressPrinter() {
  let last = 0;
  let caughtUp = false;
  return (x) => {
    const now = Date.now();
    const remaining = x.target - x.to;
    if (remaining === 0 && !x.added && !x.anomalies) {
      // Once caught up, do not print every empty range (print once when catching up)
      if (!caughtUp) console.log('Caught up to just behind the head (block ' + x.to + '). From now on, only ranges with actions are shown');
      caughtUp = true;
      return;
    }
    if (remaining > 0) caughtUp = false;
    if (x.added || x.anomalies) {
      console.log('Blocks ' + x.from + '-' + x.to + ': ' + x.added + ' action(s)' + (x.anomalies ? ', ' + x.anomalies + ' item(s) for review' : ''));
      last = now;
    } else if (now - last >= 10000) {
      console.log('Read up to block ' + x.to + ' (target ' + x.target + ', ' + (x.target - x.to) + ' blocks left)');
      last = now;
    }
  };
}

async function prepareDecoder(cfg) {
  if (!cfg.tableUrl && !cfg.tableFile) return { get: () => null, note: 'No statistics table configured (bodies stay as bytes)' };
  let decoder = null;
  let note;
  try {
    decoder = smlMakeDecoder(await loadTable(cfg));
    note = 'Body statistics table: loaded, SHA-256 matched';
  } catch (e) {
    note = 'Cannot use the body statistics table (' + e.message + '). Bodies are stored and shown as bytes';
  }
  return { get: () => decoder, note };
}

async function main() {
  if (!cmd) usage();
  const cfg = await loadConfig(configPath);
  const chain = makeChain(cfg);

  if (cmd === 'diagnose') {
    // POST to the RPC directly, without ethers, to see the HTTP status and the raw response body
    const post = async (method, params, url = cfg.rpcUrl) => {
      const t0 = Date.now();
      try {
        const res = await fetch(url, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          signal: AbortSignal.timeout(30000),
        });
        const text = await res.text();
        return { http: res.status, ms: Date.now() - t0, text, headers: res.headers };
      } catch (e) {
        return { http: '-', ms: Date.now() - t0, text: '(' + e.message + ')', headers: null };
      }
    };
    const showHeaders = (h) => {
      if (!h) return '';
      const keep = [];
      for (const [k, v] of h) if (/rate|limit|retry|x-ratelimit/i.test(k)) keep.push(k + '=' + v);
      return keep.length ? '  headers: ' + keep.join(', ') : '';
    };
    console.log('RPC: ' + cfg.rpcUrl);
    console.log('Archive: ' + (cfg.archiveRpcUrl ? hideKey(cfg.archiveRpcUrl) : '(not set)'));
    const bn = await post('eth_blockNumber', []);
    console.log('eth_blockNumber -> HTTP ' + bn.http + ', ' + bn.ms + 'ms, ' + bn.text.slice(0, 200));
    const head = parseInt(JSON.parse(bn.text).result, 16);
    const from = cfg.startBlock ?? head - 20000;
    const topics = [['ActionsProcessed', 'ActionsProcessedZk', 'ActionRejected', 'OwnerSet', 'UsernameMinted'].map((n) => EVENTS.getEvent(n).topicHash)];
    const address = [cfg.cawActions, cfg.ledger, ...(cfg.cawActionsErc1271 ? [cfg.cawActionsErc1271] : [])];
    console.log('Querying eth_getLogs from block ' + from + ' at several widths, one call per second');
    for (const w of [10000, 5000, 2000, 1000, 500, 250, 125]) {
      const r = await post('eth_getLogs', [{ address, topics, fromBlock: '0x' + from.toString(16), toBlock: '0x' + (from + w - 1).toString(16) }]);
      let summary = r.text.slice(0, 300);
      try { const j = JSON.parse(r.text); if (Array.isArray(j.result)) summary = j.result.length + ' log(s)'; } catch { /* keep as is */ }
      console.log('  width ' + String(w).padStart(5) + ' -> HTTP ' + r.http + ', ' + r.ms + 'ms, ' + summary + showHeaders(r.headers));
      await new Promise((ok) => setTimeout(ok, 1000));
    }
    // Whether block contents (time, transactions), not just logs, can be fetched that far back
    const blk = await post('eth_getBlockByNumber', ['0x' + from.toString(16), false]);
    let bsum = blk.text.slice(0, 300);
    try { const j = JSON.parse(blk.text); if (j.result) bsum = 'Got the block contents (' + j.result.transactions.length + ' transaction(s))'; } catch { /* keep as is */ }
    console.log('Contents of block ' + from + ' (eth_getBlockByNumber) -> HTTP ' + blk.http + ', ' + blk.ms + 'ms, ' + bsum);
    if (cfg.archiveRpcUrl) {
      const a = await post('eth_getBlockByNumber', ['0x' + from.toString(16), true], cfg.archiveRpcUrl);
      let asum = a.text.slice(0, 300);
      let firstTx = null;
      try {
        const j = JSON.parse(a.text);
        if (j.result) { asum = 'Got the block contents (' + j.result.transactions.length + ' transaction(s))'; firstTx = j.result.transactions[0]?.hash ?? null; }
      } catch { /* keep as is */ }
      console.log('Contents of block ' + from + ' from the archive -> HTTP ' + a.http + ', ' + a.ms + 'ms, ' + asum);
      if (firstTx) {
        const t = await post('eth_getTransactionByHash', [firstTx], cfg.archiveRpcUrl);
        let tsum = t.text.slice(0, 200);
        try { const j = JSON.parse(t.text); if (j.result) tsum = 'Got the transaction body (calldata ' + ((j.result.input.length - 2) / 2) + ' bytes)'; } catch { /* keep as is */ }
        console.log('A transaction body in that block from the archive -> HTTP ' + t.http + ', ' + t.ms + 'ms, ' + tsum);
      }
    }
    console.log('Querying width 125 ten times in a row without pauses (to see whether there is a rate limit)');
    for (let i = 0; i < 10; i++) {
      const f = from + i * 125;
      const r = await post('eth_getLogs', [{ address, topics, fromBlock: '0x' + f.toString(16), toBlock: '0x' + (f + 124).toString(16) }]);
      let summary = r.text.slice(0, 300);
      try { const j = JSON.parse(r.text); if (Array.isArray(j.result)) summary = j.result.length + ' log(s)'; } catch { /* keep as is */ }
      console.log('  #' + String(i + 1).padStart(2) + ' -> HTTP ' + r.http + ', ' + r.ms + 'ms, ' + summary + showHeaders(r.headers));
    }
    return;
  }

  if (cmd === 'find-start') {
    console.log('RPC: ' + cfg.rpcUrl);
    const head = await chain.getBlockNumber();
    console.log('Latest block: ' + head);
    const has = async (b) => (await chain.getCode(cfg.cawActions, b)) !== '0x';
    if (!(await has(head))) throw new Error('There is no code at the CawActions address at the latest block. The address or the chain is wrong');
    console.log('Found the CawActions code. Binary-searching for the deployment block (about 30 calls)');
    let lo = 0, hi = head; // hi has code
    let step = 0;
    try {
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        const yes = await has(mid);
        if (yes) hi = mid; else lo = mid + 1;
        console.log('  #' + String(++step).padStart(2) + ': block ' + mid + ' ' + (yes ? 'has code' : 'has no code') + ' (remaining range ' + lo + '-' + hi + ')');
      }
    } catch (e) {
      throw new Error('Could not read the state of past blocks (this RPC does not seem to return old state): ' + (e.shortMessage || e.message) + '\nLook up the block of the CawActions creation transaction in an explorer and set it as startBlock');
    }
    console.log('First block with the CawActions code: ' + lo);
    console.log('Set startBlock in config.json to ' + lo);
    return;
  }

  const db = openDb(cfg.db);
  checkFingerprint(db, fingerprint(cfg));

  if (cmd === 'status') {
    const { makeApi } = await import('../src/server.mjs');
    const st = makeApi(db, () => null)('/api/status', new URLSearchParams());
    // status does not load the statistics table, so its state is not shown (see the side panel of the UI while running)
    delete st.bodyTable;
    console.log(JSON.stringify(st, null, 2));
    return;
  }

  if (cmd === 'sync') {
    const r = await syncOnce(db, chain, cfg, { onRange: progressPrinter() });
    const n = await refreshNames(db, chain, 1000);
    const n1 = await refreshL1Names(db, chain, cfg, 100000);
    if (chain.l1) console.log('L1 names: read ' + n1);
    const { indexOther, indexCawTips } = await import('../src/other.mjs');
    while (indexCawTips(db) > 0) { /* catch up on the backlog */ }
    const dec = await prepareDecoder(cfg);
    let k = 0, step;
    while ((step = indexOther(db, dec.get())) > 0) k += step;
    console.log('Interpreted OTHER actions: ' + k + ' (' + dec.note + ')');
    console.log('Done: head ' + r.head + ', next from ' + r.next + '. Actions added this run: ' + r.added + ', names: ' + n);
    return;
  }

  if (cmd === 'serve' || cmd === 'run') {
    const dec = await prepareDecoder(cfg);
    console.log(dec.note);
    await startServer(db, cfg, dec.get);
    console.log('UI: http://' + cfg.listen.host + ':' + cfg.listen.port + '/');
    if (cmd === 'run') {
      console.log('Starting to read (next from ' + (getMeta(db, 'next_block') ?? cfg.startBlock) + '). Stop with Ctrl+C');
      await runLoop(db, chain, cfg, { onRange: progressPrinter(), getDecoder: dec.get });
    }
    return;
  }
  usage();
}

main().catch((e) => {
  console.error('Error: ' + describeError(e));
  process.exit(1);
});

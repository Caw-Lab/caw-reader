// SPDX-License-Identifier: MIT
//
// Read-only HTTP server for local viewing. Accepts GET only and listens on 127.0.0.1 by default.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { hexlify } from 'ethers';
import { ACTION_TYPES } from './decode.mjs';
import { getMeta } from './db.mjs';
import { readBody } from './smltxt.mjs';
import { makeStats } from './other.mjs';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
};

const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  // The UI uses only files from this server. No external images or scripts are loaded
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

function intParam(v, def, min, max) {
  if (v == null || v === '') return def;
  if (!/^\d{1,16}$/.test(v)) return null;
  const n = Number(v);
  return n < min || n > max ? null : n;
}

export function makeApi(db, getDecoder) {
  const q = {
    posts: db.prepare(`SELECT a.*, b.block_number, b.block_time, b.tx_hash, b.contract, b.kind,
        COALESCE(s.name, s.l1_name) AS sender_name, COALESCE(r.name, r.l1_name) AS receiver_name
      FROM actions a JOIN batches b ON b.id = a.batch_id
      LEFT JOIN users s ON s.id = a.sender_id LEFT JOIN users r ON r.id = a.receiver_id
      WHERE a.type = 0 AND a.status = 'accepted' AND a.seq < ? ORDER BY a.seq DESC LIMIT ?`),
    userPosts: db.prepare(`SELECT a.*, b.block_number, b.block_time, b.tx_hash, b.contract, b.kind,
        COALESCE(s.name, s.l1_name) AS sender_name, COALESCE(r.name, r.l1_name) AS receiver_name
      FROM actions a JOIN batches b ON b.id = a.batch_id
      LEFT JOIN users s ON s.id = a.sender_id LEFT JOIN users r ON r.id = a.receiver_id
      WHERE a.sender_id = ? AND a.type = 0 AND a.status = 'accepted' AND a.seq < ? ORDER BY a.seq DESC LIMIT ?`),
    actions: db.prepare(`SELECT a.*, b.block_number, b.block_time, b.tx_hash, b.contract, b.kind,
        COALESCE(s.name, s.l1_name) AS sender_name, COALESCE(r.name, r.l1_name) AS receiver_name
      FROM actions a JOIN batches b ON b.id = a.batch_id
      LEFT JOIN users s ON s.id = a.sender_id LEFT JOIN users r ON r.id = a.receiver_id
      WHERE a.seq < ? ORDER BY a.seq DESC LIMIT ?`),
    user: db.prepare('SELECT * FROM users WHERE id = ?'),
    followers: db.prepare('SELECT COUNT(*) AS n FROM follows WHERE target_id = ? AND following = 1'),
    following: db.prepare('SELECT COUNT(*) AS n FROM follows WHERE follower_id = ? AND following = 1'),
    counts: db.prepare(`SELECT
        (SELECT COUNT(*) FROM batches) AS batches,
        (SELECT COUNT(*) FROM batches WHERE resolved = 0) AS unresolved,
        (SELECT COUNT(*) FROM actions WHERE status = 'accepted') AS accepted,
        (SELECT COUNT(*) FROM actions WHERE status <> 'accepted') AS not_accepted,
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM users WHERE name IS NOT NULL OR l1_name IS NOT NULL) AS users_named,
        (SELECT COUNT(*) FROM anomalies) AS anomalies,
        (SELECT COUNT(*) FROM other_parsed) AS other_parsed,
        (SELECT COUNT(*) FROM actions WHERE type = 7 AND status = 'accepted') AS other_total`),
    anomalies: db.prepare('SELECT * FROM anomalies ORDER BY id DESC LIMIT ?'),
  };

  const stats = makeStats(db);
  const MAX = Number.MAX_SAFE_INTEGER;
  const num = (v) => (v == null ? null : Number(v));
  const toJson = (r) => {
    const body = readBody(new Uint8Array(r.text), getDecoder());
    let extra = {};
    if (r.status === 'accepted' && r.type === 0) extra = { stats: stats.forPost(r.sender_id, r.cawonce, body.text) };
    if (r.status === 'accepted' && r.type === 3) extra = { hiddenRecaw: stats.recawHidden(r.sender_id, r.receiver_id, r.receiver_cawonce) };
    return { ...extra,
      seq: r.seq, block: r.block_number, time: r.block_time, tx: r.tx_hash, path: r.contract + '/' + r.kind,
      type: r.type, typeName: ACTION_TYPES[r.type] ?? ('UNKNOWN_' + r.type), status: r.status,
      senderId: r.sender_id, senderName: r.sender_name, receiverId: r.receiver_id, receiverName: r.receiver_name,
      receiverCawonce: r.receiver_cawonce, networkId: r.network_id, cawonce: r.cawonce,
      recipients: JSON.parse(r.recipients), amounts: JSON.parse(r.amounts),
      text: body.text, textKind: body.kind, textHex: hexlify(new Uint8Array(r.text)),
      rejectReason: r.reject_reason,
    };
  };

  return function route(path, params) {
    let m;
    if (path === '/api/status') {
      return {
        nextBlock: num(getMeta(db, 'next_block')), headSeen: num(getMeta(db, 'head_seen')),
        logWindow: Number(getMeta(db, 'log_window')) || null,
        lastOk: Number(getMeta(db, 'last_ok')) || null, lastError: getMeta(db, 'last_error'),
        bodyTable: getDecoder() ? 'loaded' : 'unavailable',
        ...q.counts.get(),
      };
    }
    const limit = intParam(params.get('limit'), 50, 1, 100);
    const before = intParam(params.get('before'), MAX, 0, MAX);
    if (limit == null || before == null) return { error: 'bad_param', status: 400 };
    if (path === '/api/posts') return { items: q.posts.all(before, limit).map(toJson) };
    if (path === '/api/actions') return { items: q.actions.all(before, limit).map(toJson) };
    if (path === '/api/anomalies') return { items: q.anomalies.all(limit) };
    if ((m = path.match(/^\/api\/users\/(\d{1,10})$/))) {
      const id = Number(m[1]);
      const u = q.user.get(id);
      if (!u) return { error: 'not_found', status: 404 };
      return { id, name: u.name ?? u.l1_name, l2Name: u.name, l1Name: u.l1_name, owner: u.owner, mintedBlock: u.minted_block,
        followers: q.followers.get(id).n, following: q.following.get(id).n, ...stats.profile(id) };
    }
    if ((m = path.match(/^\/api\/users\/(\d{1,10})\/posts$/))) {
      return { items: q.userPosts.all(Number(m[1]), before, limit).map(toJson) };
    }
    return { error: 'not_found', status: 404 };
  };
}

export function startServer(db, cfg, getDecoder) {
  const route = makeApi(db, getDecoder);
  const allowedHosts = new Set([cfg.listen.host + ':' + cfg.listen.port, 'localhost:' + cfg.listen.port, '127.0.0.1:' + cfg.listen.port]);
  const server = createServer(async (req, res) => {
    try {
      // Refuse DNS rebinding, where another site swaps name resolution to read this server
      if (!allowedHosts.has(String(req.headers.host || ''))) { res.writeHead(421, HEADERS); return res.end(); }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { ...HEADERS, Allow: 'GET, HEAD' }); return res.end(); }
      const url = new URL(req.url, 'http://localhost');
      if (STATIC[url.pathname]) {
        const [file, type] = STATIC[url.pathname];
        const body = await readFile(PUBLIC + file);
        res.writeHead(200, { ...HEADERS, 'Content-Type': type });
        return res.end(req.method === 'HEAD' ? undefined : body);
      }
      const out = route(url.pathname, url.searchParams);
      const status = out.status || 200;
      delete out.status;
      res.writeHead(status, { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(out));
    } catch (e) {
      res.writeHead(500, { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'internal' }));
      console.error(e);
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.listen.port, cfg.listen.host, () => resolve(server));
  });
}

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
import { makeAuthority } from './authority.mjs';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/sign.js': ['sign.js', 'text/javascript; charset=utf-8'],
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

export function makeApi(db, getDecoder, getAuthority = null) {
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
    // One post and the batch it came in (for the receipt page)
    post: db.prepare(`SELECT a.*, b.block_number, b.block_time, b.tx_hash, b.log_index, b.contract, b.kind, b.validator_id,
        b.batch_hash, b.action_count, b.resolved,
        COALESCE(s.name, s.l1_name) AS sender_name, COALESCE(r.name, r.l1_name) AS receiver_name
      FROM actions a JOIN batches b ON b.id = a.batch_id
      LEFT JOIN users s ON s.id = a.sender_id LEFT JOIN users r ON r.id = a.receiver_id
      WHERE a.sender_id = ? AND a.cawonce = ? AND a.type = 0 AND a.status = 'accepted'`),
    // LIKE / UNLIKE / RECAW pointing at a post (the receiverCawonce mapping of the spec memo)
    related: db.prepare(`SELECT a.seq, a.type, a.sender_id, b.block_time, b.tx_hash, COALESCE(s.name, s.l1_name) AS sender_name
      FROM actions a JOIN batches b ON b.id = a.batch_id LEFT JOIN users s ON s.id = a.sender_id
      WHERE a.receiver_id = ? AND a.receiver_cawonce = ? AND a.status = 'accepted' AND a.type IN (1, 2, 3)
      ORDER BY a.seq DESC LIMIT 100`),
    // Interpreted OTHER actions pointing at a post
    relatedOther: db.prepare(`SELECT o.seq, o.kind, o.sender_id, o.value, b.block_time, b.tx_hash, COALESCE(s.name, s.l1_name) AS sender_name
      FROM other_parsed o JOIN actions a ON a.seq = o.seq JOIN batches b ON b.id = a.batch_id LEFT JOIN users s ON s.id = o.sender_id
      WHERE o.kind IN ('tip', 'vote', 'hide_caw') AND o.target_sender = ? AND o.target_cawonce = ?
      ORDER BY o.seq DESC LIMIT 100`),
    postCount: db.prepare(`SELECT COUNT(*) AS n FROM actions WHERE sender_id = ? AND type = 0 AND status = 'accepted'`),
    // Username prefix search (uses the users_name / users_l1_name indexes)
    searchName: db.prepare(`SELECT id, name, l1_name FROM users WHERE (name >= ? AND name < ?) OR (l1_name >= ? AND l1_name < ?)
      ORDER BY id LIMIT ?`),
    daily: db.prepare(`SELECT date(b.block_time, 'unixepoch') AS day,
        SUM(a.status = 'accepted' AND a.type = 0) AS posts,
        SUM(a.status = 'accepted') AS accepted,
        SUM(a.status <> 'accepted') AS not_accepted,
        COUNT(DISTINCT CASE WHEN a.status = 'accepted' THEN a.sender_id END) AS active
      FROM batches b JOIN actions a ON a.batch_id = b.id
      WHERE b.block_time >= ? GROUP BY day ORDER BY day DESC`),
    dailyTips: db.prepare(`SELECT date(b.block_time, 'unixepoch') AS day, o.value FROM batches b
      JOIN actions a ON a.batch_id = b.id JOIN other_parsed o ON o.seq = a.seq
      WHERE b.block_time >= ? AND o.kind IN ('tip', 'tip_profile')
      UNION ALL
      SELECT date(b.block_time, 'unixepoch') AS day, t.amount AS value FROM batches b
      JOIN actions a ON a.batch_id = b.id JOIN caw_tips t ON t.seq = a.seq
      WHERE b.block_time >= ?`),
    byType: db.prepare(`SELECT a.type, a.status, COUNT(*) AS n FROM batches b JOIN actions a ON a.batch_id = b.id
      WHERE b.block_time >= ? GROUP BY a.type, a.status`),
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

  // The statistics scan many rows, so one result per period is reused for a minute
  const statsCache = new Map();
  function dailyStats(days) {
    const hit = statsCache.get(days);
    if (hit && Date.now() - hit.at < 60_000) return hit.value;
    const since = Math.floor(Date.now() / 1000) - days * 86400;
    const tips = new Map();
    for (const r of q.dailyTips.all(since, since)) {
      const t = tips.get(r.day) ?? { count: 0, total: 0n };
      t.count++; t.total += BigInt(r.value);
      tips.set(r.day, t);
    }
    const value = {
      days, timezone: 'UTC',
      daily: q.daily.all(since).map((r) => ({ day: r.day, posts: r.posts, accepted: r.accepted, notAccepted: r.not_accepted,
        active: r.active, tips: tips.get(r.day)?.count ?? 0, tipTotal: String(tips.get(r.day)?.total ?? 0n) })),
      byType: q.byType.all(since).map((r) => ({ type: r.type, typeName: ACTION_TYPES[r.type] ?? ('UNKNOWN_' + r.type), status: r.status, count: r.n })),
    };
    statsCache.set(days, { at: Date.now(), value });
    return value;
  }

  return function route(path, params) {
    let m;
    if (path === '/api/status') {
      return {
        nextBlock: num(getMeta(db, 'next_block')), headSeen: num(getMeta(db, 'head_seen')),
        logWindow: Number(getMeta(db, 'log_window')) || null,
        lastOk: Number(getMeta(db, 'last_ok')) || null, lastError: getMeta(db, 'last_error'),
        bodyTable: getDecoder() ? 'loaded' : 'unavailable',
        chain: JSON.parse(getMeta(db, 'fingerprint') ?? 'null'),
        ...q.counts.get(),
      };
    }
    if (path === '/api/authority') {
      // Read from the chain by the server (shared and cached), so the browser never calls an RPC
      return getAuthority ? getAuthority() : { error: 'not_configured', status: 404 };
    }
    if (path === '/api/stats') {
      const days = intParam(params.get('days'), 30, 1, 365);
      if (days == null) return { error: 'bad_param', status: 400 };
      return dailyStats(days);
    }
    if (path === '/api/users') {
      // Prefix search by username (without @), or a token id such as 13 or #13
      const raw = String(params.get('q') ?? '').trim().replace(/^@/, '').toLowerCase();
      if (!raw || raw.length > 32) return { error: 'bad_param', status: 400 };
      if (/^#?\d{1,10}$/.test(raw)) {
        const id = Number(raw.replace('#', ''));
        const u = q.user.get(id);
        return { items: u ? [{ id, name: u.name ?? u.l1_name, l1Name: u.l1_name }] : [] };
      }
      const hi = raw + '\uffff';
      return { items: q.searchName.all(raw, hi, raw, hi, 20).map((u) => ({ id: u.id, name: u.name ?? u.l1_name, l1Name: u.l1_name })) };
    }
    if ((m = path.match(/^\/api\/posts\/(\d{1,10})\/(\d{1,10})$/))) {
      const sender = Number(m[1]); const cawonce = Number(m[2]);
      const r = q.post.get(sender, cawonce);
      if (!r) return { error: 'not_found', status: 404 };
      const related = [
        ...q.related.all(sender, cawonce).map((x) => ({ seq: x.seq, kind: ACTION_TYPES[x.type].toLowerCase(), senderId: x.sender_id, senderName: x.sender_name, time: x.block_time, tx: x.tx_hash, value: null })),
        ...q.relatedOther.all(sender, cawonce).map((x) => ({ seq: x.seq, kind: x.kind, senderId: x.sender_id, senderName: x.sender_name, time: x.block_time, tx: x.tx_hash, value: x.value })),
      ].sort((x, y) => y.seq - x.seq);
      // The post is nested: its own "status" field must not be read as the HTTP status
      return { post: toJson(r),
        receipt: { logIndex: r.log_index, contract: r.contract, kind: r.kind, validatorId: r.validator_id, batchHash: r.batch_hash,
          batchSize: r.action_count, indexInBatch: r.idx, resolved: !!r.resolved, bodyBytes: new Uint8Array(r.text).length },
        related };
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
        followers: q.followers.get(id).n, following: q.following.get(id).n, posts: q.postCount.get(id).n, ...stats.profile(id) };
    }
    if ((m = path.match(/^\/api\/users\/(\d{1,10})\/posts$/))) {
      return { items: q.userPosts.all(Number(m[1]), before, limit).map(toJson) };
    }
    return { error: 'not_found', status: 404 };
  };
}

export function startServer(db, cfg, getDecoder, { authority = makeAuthority(cfg) } = {}) {
  const route = makeApi(db, getDecoder, authority);
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
      const out = { ...(await route(url.pathname, url.searchParams)) };
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

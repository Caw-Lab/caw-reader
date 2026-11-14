// SPDX-License-Identifier: MIT
//
// Interprets the bodies of OTHER actions. The only source is the spec memo section
// "OTHER actions and body conventions (observed in real data)".
// The upstream client code was not used as a reference (clean room).
// Only forms whose meaning was checked by observation are interpreted; anything else is kept as is, with kind 'other'.

import { getMeta, setMeta, tx } from './db.mjs';
import { readBody } from './smltxt.mjs';

const U32 = 0xffffffff;
const num = (s) => { const n = Number(s); return Number.isSafeInteger(n) && n >= 0 && n <= U32 ? n : null; };
const MAX_PROFILE_JSON = 2000;

// a is an action (with sender_id, receiver_id, receiver_cawonce, recipients, amounts). text is the body string.
// Returns: { kind, targetSender, targetCawonce, value }
export function parseOther(a, text) {
  const none = { kind: 'other', targetSender: null, targetCawonce: null, value: null };
  if (text == null) return none;
  let m;

  // hide:caw:N -> the sender's own (sender, N)
  if ((m = text.match(/^hide:caw:(\d{1,10})$/)) && num(m[1]) != null) {
    return { kind: 'hide_caw', targetSender: a.sender_id, targetCawonce: num(m[1]), value: null };
  }
  // hide:recaw:a:b -> the sender's RECAW that points to (a, b)
  if ((m = text.match(/^hide:recaw:(\d{1,10}):(\d{1,10})$/)) && num(m[1]) != null && num(m[2]) != null) {
    return { kind: 'hide_recaw', targetSender: num(m[1]), targetCawonce: num(m[2]), value: null };
  }

  const recipients = JSON.parse(a.recipients);
  const amounts = JSON.parse(a.amounts).map((x) => BigInt(x));
  // Observed shape: one recipient equal to receiverId; amounts are the amount to the recipient (+ a tip to the validator)
  const tipShape = recipients.length === 1 && recipients[0] === a.receiver_id
    && (amounts.length === 1 || amounts.length === 2);
  const tipAmount = tipShape ? String(amounts[0]) : null;

  // tip:a:b -> only when a = receiverId and b = receiverCawonce (all 47 observed cases have this shape)
  if ((m = text.match(/^tip:(\d{1,10}):(\d{1,10})$/))) {
    if (tipShape && num(m[1]) === a.receiver_id && num(m[2]) === a.receiver_cawonce) {
      return { kind: 'tip', targetSender: a.receiver_id, targetCawonce: a.receiver_cawonce, value: tipAmount };
    }
    return none;
  }
  // tip: -> to receiverId. receiverCawonce is 0 (all 11 observed cases)
  if (text === 'tip:') {
    if (tipShape && a.receiver_cawonce === 0) return { kind: 'tip_profile', targetSender: a.receiver_id, targetCawonce: null, value: tipAmount };
    return none;
  }
  // vote:N / vote: -> (receiverId, receiverCawonce)
  if ((m = text.match(/^vote:(\d{0,3})$/))) {
    return { kind: 'vote', targetSender: a.receiver_id, targetCawonce: a.receiver_cawonce, value: m[1] };
  }
  // p:{...} -> the sender's. Only when it is a JSON object whose values are all strings
  if (text.startsWith('p:{') && text.length <= MAX_PROFILE_JSON + 2) {
    try {
      const j = JSON.parse(text.slice(2));
      if (j && typeof j === 'object' && !Array.isArray(j) && Object.values(j).every((v) => typeof v === 'string')) {
        return { kind: 'profile', targetSender: a.sender_id, targetCawonce: null, value: JSON.stringify(j) };
      }
    } catch { /* fall through */ }
    return none;
  }
  return none;
}

// Interprets OTHER actions in seq order, continuing from the previous run, into other_parsed.
// Without the statistics table the bodies cannot be read, so nothing is done then (it is tried again next time).
export function indexOther(db, decode, limit = 5000) {
  if (!decode) return 0;
  const from = Number(getMeta(db, 'other_parsed_seq')) || -1;
  const rows = db.prepare(`SELECT seq, sender_id, receiver_id, receiver_cawonce, recipients, amounts, text FROM actions
    WHERE type = 7 AND status = 'accepted' AND seq > ? ORDER BY seq LIMIT ?`).all(from, limit);
  if (rows.length === 0) return 0;
  const ins = db.prepare(`INSERT INTO other_parsed (seq, sender_id, kind, target_sender, target_cawonce, value) VALUES (?,?,?,?,?,?)
    ON CONFLICT (seq) DO NOTHING`);
  tx(db, () => {
    for (const r of rows) {
      const body = readBody(new Uint8Array(r.text), decode);
      const p = body.kind === 'session'
        ? { kind: 'session', targetSender: r.sender_id, targetCawonce: null, value: body.text }
        : parseOther(r, body.text);
      ins.run(r.seq, r.sender_id, p.kind, p.targetSender, p.targetCawonce, p.value);
    }
    setMeta(db, 'other_parsed_seq', rows[rows.length - 1].seq);
  });
  return rows.length;
}

// Puts CAWs that carry recipients and amounts into caw_tips, one row per recipient (bodies are not read, so no table is needed).
// amounts has as many entries as recipients, or one more (the last is a tip to the validator, CawActions.sol:1674-1676).
export function indexCawTips(db, limit = 5000) {
  const from = Number(getMeta(db, 'caw_tips_seq')) || -1;
  const rows = db.prepare(`SELECT seq, sender_id, cawonce, recipients, amounts FROM actions
    WHERE type = 0 AND status = 'accepted' AND seq > ? ORDER BY seq LIMIT ?`).all(from, limit);
  if (rows.length === 0) return 0;
  const ins = db.prepare('INSERT INTO caw_tips (seq, idx, sender_id, cawonce, recipient, amount) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING');
  tx(db, () => {
    for (const r of rows) {
      const rec = JSON.parse(r.recipients);
      const am = JSON.parse(r.amounts);
      if (rec.length === 0 || !(am.length === rec.length || am.length === rec.length + 1)) continue;
      rec.forEach((to, i) => ins.run(r.seq, i, r.sender_id, r.cawonce, to, String(am[i])));
    }
    setMeta(db, 'caw_tips_seq', rows[rows.length - 1].seq);
  });
  return rows.length;
}

// Per-post stats. Every lookup is by (author, cawonce), so the cost per post does not grow with the data.
export function makeStats(db) {
  const q = {
    // LIKE / UNLIKE: count the latest one per account (provisional rule)
    likes: db.prepare(`SELECT COUNT(*) AS n FROM (SELECT type, MAX(seq) FROM actions
      WHERE status = 'accepted' AND receiver_id = ? AND receiver_cawonce = ? AND type IN (1, 2) GROUP BY sender_id) WHERE type = 1`),
    recaws: db.prepare(`SELECT COUNT(*) AS n FROM actions
      WHERE status = 'accepted' AND receiver_id = ? AND receiver_cawonce = ? AND type = 3`),
    tips: db.prepare(`SELECT value FROM other_parsed WHERE kind = 'tip' AND target_sender = ? AND target_cawonce = ?`),
    cawTips: db.prepare(`SELECT amount AS value FROM caw_tips WHERE sender_id = ? AND cawonce = ?`),
    hidden: db.prepare(`SELECT 1 FROM other_parsed WHERE kind = 'hide_caw' AND target_sender = ? AND target_cawonce = ? LIMIT 1`),
    hiddenRecaw: db.prepare(`SELECT 1 FROM other_parsed WHERE kind = 'hide_recaw' AND sender_id = ? AND target_sender = ? AND target_cawonce = ? LIMIT 1`),
    // Votes: count the latest one per voter (provisional rule)
    votes: db.prepare(`SELECT value, COUNT(*) AS n FROM (SELECT value, MAX(seq) FROM other_parsed
      WHERE kind = 'vote' AND target_sender = ? AND target_cawonce = ? GROUP BY sender_id) GROUP BY value`),
    profile: db.prepare(`SELECT value FROM other_parsed WHERE kind = 'profile' AND sender_id = ? ORDER BY seq`),
    profileTips: db.prepare(`SELECT value FROM other_parsed WHERE kind = 'tip_profile' AND target_sender = ?`),
  };
  const sum = (rows) => rows.reduce((s, r) => s + BigInt(r.value), 0n);

  return {
    forPost(sender, cawonce, text) {
      // tip: to this post, and payments attached to this post itself
      const tips = [...q.tips.all(sender, cawonce), ...q.cawTips.all(sender, cawonce)];
      const out = {
        likes: q.likes.get(sender, cawonce).n,
        recaws: q.recaws.get(sender, cawonce).n,
        tips: tips.length, tipTotal: String(sum(tips)),
        hidden: !!q.hidden.get(sender, cawonce),
        poll: null,
      };
      const poll = parsePoll(text);
      if (poll) {
        const counts = Object.fromEntries(q.votes.all(sender, cawonce).map((r) => [r.value, r.n]));
        out.poll = { options: poll.options.map((label, i) => ({ label, votes: counts[String(i)] || 0 })), otherVotes: Object.entries(counts).filter(([k]) => !(Number(k) < poll.options.length) || k === '').reduce((s, [, n]) => s + n, 0) };
      }
      return out;
    },
    recawHidden(sender, targetSender, targetCawonce) { return !!q.hiddenRecaw.get(sender, targetSender, targetCawonce); },
    profile(sender) {
      // The latest value of each p: key
      const merged = {};
      for (const r of q.profile.all(sender)) Object.assign(merged, JSON.parse(r.value));
      const tips = q.profileTips.all(sender);
      return { fields: merged, profileTips: tips.length, profileTipTotal: String(sum(tips)) };
    },
  };
}

// The ::poll:option:option:: ... form at the end of a CAW body (spec memo section "Conventions inside CAW bodies")
export function parsePoll(text) {
  if (typeof text !== 'string') return null;
  const i = text.indexOf('::poll:');
  if (i < 0) return null;
  const rest = text.slice(i + 7);
  const end = rest.indexOf('::');
  if (end < 0) return null;
  const options = rest.slice(0, end).split(':');
  if (options.length < 2 || options.some((o) => o === '')) return null;
  return { options };
}

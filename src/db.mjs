// SPDX-License-Identifier: MIT
//
// Storage (Node's built-in SQLite). Only facts read from the chain are stored; bodies are kept as compressed bytes.
// Bodies are decoded when read out (so collection does not stop even if the statistics table is unavailable).

import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- One row per ActionsProcessed / ActionsProcessedZk
CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY,
  block_number INTEGER NOT NULL,
  block_time INTEGER,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  contract TEXT NOT NULL,          -- 'actions' | 'erc1271'
  kind TEXT NOT NULL,              -- 'sig' | 'zk'
  network_id INTEGER NOT NULL,
  validator_id INTEGER NOT NULL,
  action_count INTEGER NOT NULL,
  batch_hash TEXT NOT NULL,
  resolved INTEGER NOT NULL,       -- 1 = bytes matching batchHash were found in the calldata
  note TEXT,
  UNIQUE (tx_hash, log_index)
);

-- One row per action. seq is the order on the chain (block -> log -> position in the batch)
CREATE TABLE IF NOT EXISTS actions (
  seq INTEGER PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  idx INTEGER NOT NULL,
  status TEXT NOT NULL,            -- 'accepted' | 'rejected' | 'skipped' | 'ambiguous' | 'duplicate'
  type INTEGER NOT NULL,
  sender_id INTEGER NOT NULL,
  receiver_id INTEGER NOT NULL,
  receiver_cawonce INTEGER NOT NULL,
  network_id INTEGER NOT NULL,
  cawonce INTEGER NOT NULL,
  recipients TEXT NOT NULL,        -- JSON array
  amounts TEXT NOT NULL,           -- JSON array (decimal strings)
  text BLOB NOT NULL,              -- body as on the chain (still compressed)
  reject_reason TEXT,
  UNIQUE (batch_id, idx)
);
CREATE INDEX IF NOT EXISTS actions_type_seq ON actions (type, seq) WHERE status = 'accepted';
CREATE INDEX IF NOT EXISTS actions_sender_seq ON actions (sender_id, seq);
CREATE INDEX IF NOT EXISTS actions_receiver_seq ON actions (receiver_id, seq);
-- Accepted actions are unique by (senderId, cawonce) (a cawonce cannot be reused)
CREATE UNIQUE INDEX IF NOT EXISTS actions_accepted_key ON actions (sender_id, cawonce) WHERE status = 'accepted';

-- Current follow state (the last FOLLOW/UNFOLLOW on the chain)
CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER NOT NULL,
  target_id INTEGER NOT NULL,
  following INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY (follower_id, target_id)
);
CREATE INDEX IF NOT EXISTS follows_target ON follows (target_id) WHERE following = 1;

-- Names. Built from UsernameMinted / OwnerSet of the Ledger and reads of usernames(tokenId)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT,
  owner TEXT,
  owner_seq INTEGER,
  minted_block INTEGER,
  name_checked INTEGER NOT NULL DEFAULT 0,
  l1_name TEXT                     -- CawProfile.usernames(tokenId - 1) on L1
);

-- Interpreted OTHER bodies (only the forms checked in the spec memo section "OTHER actions and body conventions").
-- kind: 'tip' 'tip_profile' 'hide_caw' 'hide_recaw' 'vote' 'profile' 'session' 'other'
CREATE TABLE IF NOT EXISTS other_parsed (
  seq INTEGER PRIMARY KEY,
  sender_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  target_sender INTEGER,
  target_cawonce INTEGER,
  value TEXT
);
CREATE INDEX IF NOT EXISTS other_target ON other_parsed (kind, target_sender, target_cawonce);
CREATE INDEX IF NOT EXISTS other_sender ON other_parsed (sender_id, kind, seq);
-- Payments attached to CAWs (CAWs with recipients and amounts). One row per recipient.
-- Checked one by one against the Tip table of node2: tips are also recorded in this form, apart from OTHER tip: (2026-10-25)
CREATE TABLE IF NOT EXISTS caw_tips (
  seq INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  sender_id INTEGER NOT NULL,
  cawonce INTEGER NOT NULL,
  recipient INTEGER NOT NULL,
  amount TEXT NOT NULL,
  PRIMARY KEY (seq, idx)
);
CREATE INDEX IF NOT EXISTS caw_tips_post ON caw_tips (sender_id, cawonce);

-- Look up by the target of LIKE, UNLIKE and RECAW (receiverId, receiverCawonce)
CREATE INDEX IF NOT EXISTS actions_target ON actions (receiver_id, receiver_cawonce, type, sender_id, seq) WHERE status = 'accepted';

-- For the daily statistics (by block time) and the username search (by prefix; the l1_name index is made in openDb)
CREATE INDEX IF NOT EXISTS batches_time ON batches (block_time);
CREATE INDEX IF NOT EXISTS users_name ON users (name);

-- Record of unexpected events (so that nothing is dropped silently)
CREATE TABLE IF NOT EXISTS anomalies (
  id INTEGER PRIMARY KEY,
  block_number INTEGER,
  tx_hash TEXT,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL
);
`;

export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  // DBs created by an earlier version have no l1_name column, so add it
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('l1_name')) db.exec('ALTER TABLE users ADD COLUMN l1_name TEXT');
  // Created after the column exists (see above)
  db.exec('CREATE INDEX IF NOT EXISTS users_l1_name ON users (l1_name)');
  return db;
}

export function getMeta(db, key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

// Checks the DB's mark against the config. Writes the mark for a new DB.
export function checkFingerprint(db, fp) {
  const cur = getMeta(db, 'fingerprint');
  if (cur == null) { setMeta(db, 'fingerprint', fp); return; }
  if (cur !== fp) {
    throw new Error('This DB belongs to a different chain or contracts. Set db in the config to a new file name.\n  DB:     ' + cur + '\n  config: ' + fp);
  }
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

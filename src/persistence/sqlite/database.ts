/**
 * SQLite database initialization.
 * Opens the database, enables WAL mode, and runs schema migrations.
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

const SCHEMA_SQL = `
-- events (IEventStore)
CREATE TABLE IF NOT EXISTS events (
  event_id         TEXT PRIMARY KEY,
  day_id           TEXT NOT NULL,
  sequence_number  INTEGER NOT NULL,
  timestamp        TEXT NOT NULL,
  event_type       TEXT NOT NULL,
  actor_id         TEXT,
  payload          TEXT NOT NULL,
  prev_event_hash  TEXT NOT NULL,
  event_hash       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_day ON events(day_id, sequence_number);
CREATE INDEX IF NOT EXISTS idx_events_actor ON events(actor_id, day_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type, day_id);

-- snapshots (IStateStore)
CREATE TABLE IF NOT EXISTS snapshots (
  day_id            TEXT PRIMARY KEY,
  day_number        INTEGER NOT NULL,
  state_hash        TEXT NOT NULL,
  last_event_hash   TEXT NOT NULL,
  reward_hash       TEXT NOT NULL,
  contributor_count INTEGER NOT NULL,
  created_at        TEXT NOT NULL
);

-- states (IStateStore — full NetworkState JSON)
CREATE TABLE IF NOT EXISTS states (
  day_id     TEXT PRIMARY KEY,
  state_json TEXT NOT NULL
);

-- assignments (IAssignmentStore)
CREATE TABLE IF NOT EXISTS assignments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  day_id          TEXT NOT NULL,
  contributor_id  TEXT NOT NULL,
  block_ids       TEXT NOT NULL,
  assigned_at     TEXT NOT NULL,
  batch_number    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assignments_day ON assignments(day_id);
CREATE INDEX IF NOT EXISTS idx_assignments_day_node ON assignments(day_id, contributor_id);

-- submissions (ISubmissionStore)
CREATE TABLE IF NOT EXISTS submissions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  day_id                TEXT NOT NULL,
  contributor_id        TEXT NOT NULL,
  block_id              TEXT NOT NULL,
  block_type            TEXT NOT NULL,
  resource_usage        REAL NOT NULL,
  difficulty_multiplier REAL NOT NULL,
  validation_passed     INTEGER NOT NULL,
  canary_answer_correct INTEGER,
  timestamp             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_submissions_day ON submissions(day_id);
CREATE INDEX IF NOT EXISTS idx_submissions_day_node ON submissions(day_id, contributor_id);

-- kv_store (day lifecycle, nodeKeys, devices)
CREATE TABLE IF NOT EXISTS kv_store (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- balances (accumulated token balances per account)
CREATE TABLE IF NOT EXISTS balances (
  account_id          TEXT PRIMARY KEY,
  balance_micro       TEXT NOT NULL DEFAULT '0',
  total_earned_micro  TEXT NOT NULL DEFAULT '0',
  last_reward_day     TEXT,
  updated_at          TEXT NOT NULL
);

-- balance_history (per-day reward credits and future withdrawals)
CREATE TABLE IF NOT EXISTS balance_history (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id          TEXT NOT NULL,
  day_id              TEXT NOT NULL,
  amount_micro        TEXT NOT NULL,
  balance_after_micro TEXT NOT NULL,
  entry_type          TEXT NOT NULL,
  timestamp           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_balance_history_account ON balance_history(account_id);
CREATE INDEX IF NOT EXISTS idx_balance_history_day ON balance_history(day_id);
`;

export function openDatabase(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? path.join(process.cwd(), 'data', 'ai4all.db');

  // Ensure directory exists
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(resolvedPath);

  // WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run schema migrations
  db.exec(SCHEMA_SQL);

  return db;
}

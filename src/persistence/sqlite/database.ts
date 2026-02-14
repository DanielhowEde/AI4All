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

-- wallet_chain (per-wallet identity blocks)
CREATE TABLE IF NOT EXISTS wallet_chain (
  block_hash       TEXT PRIMARY KEY,
  prev_block_hash  TEXT NOT NULL,
  block_number     INTEGER NOT NULL,
  timestamp        TEXT NOT NULL,
  wallet_address   TEXT NOT NULL,
  public_key       TEXT NOT NULL,
  events_json      TEXT NOT NULL,
  events_merkle_root TEXT NOT NULL,
  signature        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_chain_address ON wallet_chain(wallet_address, block_number);

-- transaction_chain (global daily transaction blocks, 30-day rolling)
CREATE TABLE IF NOT EXISTS transaction_chain (
  block_hash           TEXT PRIMARY KEY,
  prev_block_hash      TEXT NOT NULL,
  block_number         INTEGER NOT NULL,
  timestamp            TEXT NOT NULL,
  day_id               TEXT NOT NULL UNIQUE,
  events_json          TEXT NOT NULL,
  reward_merkle_root   TEXT NOT NULL,
  state_hash           TEXT NOT NULL,
  wallet_chain_ref     TEXT NOT NULL,
  contributor_count    INTEGER NOT NULL,
  total_emissions_micro TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_chain_day ON transaction_chain(day_id);
CREATE INDEX IF NOT EXISTS idx_tx_chain_number ON transaction_chain(block_number);

-- personas (registered persona instances)
CREATE TABLE IF NOT EXISTS personas (
  persona_id        TEXT PRIMARY KEY,
  persona_type      TEXT NOT NULL,
  device_id         TEXT NOT NULL,
  account_id        TEXT NOT NULL,
  registered_at     TEXT NOT NULL,
  wallet_block_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_personas_device ON personas(device_id);
CREATE INDEX IF NOT EXISTS idx_personas_account ON personas(account_id);

-- programmes (programme definitions)
CREATE TABLE IF NOT EXISTS programmes (
  programme_id          TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  description           TEXT NOT NULL,
  master_ba_persona_id  TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'ACTIVE'
);

-- projects (project definitions within programmes)
CREATE TABLE IF NOT EXISTS projects (
  project_id              TEXT PRIMARY KEY,
  programme_id            TEXT NOT NULL,
  name                    TEXT NOT NULL,
  description             TEXT NOT NULL,
  project_ba_persona_id   TEXT NOT NULL,
  acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
  created_at              TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'PLANNING'
);
CREATE INDEX IF NOT EXISTS idx_projects_programme ON projects(programme_id);

-- milestones (milestone lifecycle within projects)
CREATE TABLE IF NOT EXISTS milestones (
  milestone_id                TEXT PRIMARY KEY,
  project_id                  TEXT NOT NULL,
  name                        TEXT NOT NULL,
  description                 TEXT NOT NULL,
  acceptance_criteria_json    TEXT NOT NULL DEFAULT '[]',
  assigned_coder_persona_id   TEXT,
  assigned_tester_persona_id  TEXT,
  state                       TEXT NOT NULL DEFAULT 'DEFINED',
  token_reward                TEXT NOT NULL DEFAULT '0',
  deliverable_hash            TEXT,
  test_report_hash            TEXT,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id);
CREATE INDEX IF NOT EXISTS idx_milestones_state ON milestones(state);

-- milestone_history (audit trail of state transitions)
CREATE TABLE IF NOT EXISTS milestone_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  milestone_id  TEXT NOT NULL,
  from_state    TEXT NOT NULL,
  to_state      TEXT NOT NULL,
  persona_id    TEXT NOT NULL,
  timestamp     TEXT NOT NULL,
  reason        TEXT
);
CREATE INDEX IF NOT EXISTS idx_milestone_history_ms ON milestone_history(milestone_id);

-- persona_messages (inter-persona messaging)
CREATE TABLE IF NOT EXISTS persona_messages (
  message_id        TEXT PRIMARY KEY,
  from_persona_id   TEXT NOT NULL,
  to_persona_id     TEXT NOT NULL,
  subject           TEXT NOT NULL,
  content           TEXT NOT NULL,
  milestone_id      TEXT,
  created_at        TEXT NOT NULL,
  read              INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_persona_messages_to ON persona_messages(to_persona_id, read);
CREATE INDEX IF NOT EXISTS idx_persona_messages_from ON persona_messages(from_persona_id);
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

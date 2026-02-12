export { openDatabase } from './database';
export { SqliteEventStore } from './SqliteEventStore';
export { SqliteStateStore } from './SqliteStateStore';
export { SqliteAssignmentStore } from './SqliteAssignmentStore';
export { SqliteSubmissionStore } from './SqliteSubmissionStore';
export { SqliteKvStore } from './kvStore';
export { SqliteBalanceStore } from './SqliteBalanceStore';
export { serializeNetworkState, deserializeNetworkState } from './stateSerializer';

import type Database from 'better-sqlite3';
import { openDatabase } from './database';
import { SqliteEventStore } from './SqliteEventStore';
import { SqliteStateStore } from './SqliteStateStore';
import { SqliteAssignmentStore } from './SqliteAssignmentStore';
import { SqliteSubmissionStore } from './SqliteSubmissionStore';
import { SqliteKvStore } from './kvStore';
import { SqliteBalanceStore } from './SqliteBalanceStore';

export interface SqliteStores {
  db: Database.Database;
  event: SqliteEventStore;
  state: SqliteStateStore;
  assignment: SqliteAssignmentStore;
  submission: SqliteSubmissionStore;
  kv: SqliteKvStore;
  balance: SqliteBalanceStore;
}

export function createSqliteStores(dbPath?: string): SqliteStores {
  const db = openDatabase(dbPath);
  return {
    db,
    event: new SqliteEventStore(db),
    state: new SqliteStateStore(db),
    assignment: new SqliteAssignmentStore(db),
    submission: new SqliteSubmissionStore(db),
    kv: new SqliteKvStore(db),
    balance: new SqliteBalanceStore(db),
  };
}

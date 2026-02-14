export { openDatabase } from './database';
export { SqliteEventStore } from './SqliteEventStore';
export { SqliteStateStore } from './SqliteStateStore';
export { SqliteAssignmentStore } from './SqliteAssignmentStore';
export { SqliteSubmissionStore } from './SqliteSubmissionStore';
export { SqliteKvStore } from './kvStore';
export { SqliteBalanceStore } from './SqliteBalanceStore';
export { SqliteChainStore } from './SqliteChainStore';
export { SqliteGovernanceStore } from './SqliteGovernanceStore';
export { serializeNetworkState, deserializeNetworkState } from './stateSerializer';

import type Database from 'better-sqlite3';
import { openDatabase } from './database';
import { SqliteEventStore } from './SqliteEventStore';
import { SqliteStateStore } from './SqliteStateStore';
import { SqliteAssignmentStore } from './SqliteAssignmentStore';
import { SqliteSubmissionStore } from './SqliteSubmissionStore';
import { SqliteKvStore } from './kvStore';
import { SqliteBalanceStore } from './SqliteBalanceStore';
import { SqliteChainStore } from './SqliteChainStore';
import { SqliteGovernanceStore } from './SqliteGovernanceStore';

export interface SqliteStores {
  db: Database.Database;
  event: SqliteEventStore;
  state: SqliteStateStore;
  assignment: SqliteAssignmentStore;
  submission: SqliteSubmissionStore;
  kv: SqliteKvStore;
  balance: SqliteBalanceStore;
  chain: SqliteChainStore;
  governance: SqliteGovernanceStore;
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
    chain: new SqliteChainStore(db),
    governance: new SqliteGovernanceStore(db),
  };
}

import type Database from 'better-sqlite3';
import { IStateStore, StateSnapshot } from '../interfaces';
import { NetworkState } from '../../services/serviceTypes';
import { serializeNetworkState, deserializeNetworkState } from './stateSerializer';

export class SqliteStateStore implements IStateStore {
  private stmtSaveSnapshot;
  private stmtLoadSnapshot;
  private stmtLatestSnapshot;
  private stmtSaveState;
  private stmtLoadState;

  constructor(db: Database.Database) {
    this.stmtSaveSnapshot = db.prepare(`
      INSERT OR REPLACE INTO snapshots (day_id, day_number, state_hash, last_event_hash, reward_hash, contributor_count, created_at)
      VALUES (@dayId, @dayNumber, @stateHash, @lastEventHash, @rewardHash, @contributorCount, @createdAt)
    `);
    this.stmtLoadSnapshot = db.prepare(
      'SELECT * FROM snapshots WHERE day_id = ?'
    );
    this.stmtLatestSnapshot = db.prepare(
      'SELECT * FROM snapshots ORDER BY day_id DESC LIMIT 1'
    );
    this.stmtSaveState = db.prepare(
      'INSERT OR REPLACE INTO states (day_id, state_json) VALUES (?, ?)'
    );
    this.stmtLoadState = db.prepare(
      'SELECT state_json FROM states WHERE day_id = ?'
    );
  }

  async saveSnapshot(snapshot: StateSnapshot): Promise<void> {
    this.stmtSaveSnapshot.run({
      dayId: snapshot.dayId,
      dayNumber: snapshot.dayNumber,
      stateHash: snapshot.stateHash,
      lastEventHash: snapshot.lastEventHash,
      rewardHash: snapshot.rewardHash,
      contributorCount: snapshot.contributorCount,
      createdAt: snapshot.createdAt,
    });
  }

  async loadSnapshot(dayId: string): Promise<StateSnapshot | undefined> {
    const row = this.stmtLoadSnapshot.get(dayId) as SnapshotRow | undefined;
    return row ? rowToSnapshot(row) : undefined;
  }

  async loadLatestSnapshot(): Promise<StateSnapshot | undefined> {
    const row = this.stmtLatestSnapshot.get() as SnapshotRow | undefined;
    return row ? rowToSnapshot(row) : undefined;
  }

  async saveState(dayId: string, state: NetworkState): Promise<void> {
    this.stmtSaveState.run(dayId, serializeNetworkState(state));
  }

  async loadState(dayId: string): Promise<NetworkState | undefined> {
    const row = this.stmtLoadState.get(dayId) as { state_json: string } | undefined;
    return row ? deserializeNetworkState(row.state_json) : undefined;
  }
}

interface SnapshotRow {
  day_id: string;
  day_number: number;
  state_hash: string;
  last_event_hash: string;
  reward_hash: string;
  contributor_count: number;
  created_at: string;
}

function rowToSnapshot(row: SnapshotRow): StateSnapshot {
  return {
    dayId: row.day_id,
    dayNumber: row.day_number,
    stateHash: row.state_hash,
    lastEventHash: row.last_event_hash,
    rewardHash: row.reward_hash,
    contributorCount: row.contributor_count,
    createdAt: row.created_at,
  };
}

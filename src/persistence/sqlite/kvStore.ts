/**
 * Simple key-value store backed by SQLite.
 * Used for: nodeKeys, devices, day lifecycle state.
 */

import type Database from 'better-sqlite3';

export class SqliteKvStore {
  private stmtGet;
  private stmtSet;
  private stmtDelete;

  constructor(db: Database.Database) {
    this.stmtGet = db.prepare('SELECT value FROM kv_store WHERE key = ?');
    this.stmtSet = db.prepare('INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)');
    this.stmtDelete = db.prepare('DELETE FROM kv_store WHERE key = ?');
  }

  get(key: string): string | undefined {
    const row = this.stmtGet.get(key) as { value: string } | undefined;
    return row?.value;
  }

  set(key: string, value: string): void {
    this.stmtSet.run(key, value);
  }

  delete(key: string): void {
    this.stmtDelete.run(key);
  }

  getJSON<T>(key: string): T | undefined {
    const raw = this.get(key);
    return raw != null ? JSON.parse(raw) as T : undefined;
  }

  setJSON(key: string, value: unknown): void {
    this.set(key, JSON.stringify(value));
  }

  // ── Convenience methods for common state ────────────────────────

  saveNodeKeys(nodeKeys: Map<string, string>): void {
    this.setJSON('nodeKeys', Array.from(nodeKeys.entries()));
  }

  loadNodeKeys(): Map<string, string> {
    const entries = this.getJSON<Array<[string, string]>>('nodeKeys');
    return entries ? new Map(entries) : new Map();
  }

  saveDevices(
    devices: Map<string, unknown>,
    accountDevices: Map<string, string[]>
  ): void {
    this.setJSON('devices', Array.from(devices.entries()));
    this.setJSON('accountDevices', Array.from(accountDevices.entries()));
  }

  loadDevices(): {
    devices: Map<string, unknown>;
    accountDevices: Map<string, string[]>;
  } {
    const devEntries = this.getJSON<Array<[string, unknown]>>('devices');
    const accEntries = this.getJSON<Array<[string, string[]]>>('accountDevices');
    return {
      devices: devEntries ? new Map(devEntries) : new Map(),
      accountDevices: accEntries ? new Map(accEntries) : new Map(),
    };
  }

  saveDayPhase(data: {
    dayPhase: string;
    currentDayId: string | null;
    currentDaySeed: number | null;
    rosterAccountIds: string[];
    canaryBlockIds: string[];
  }): void {
    this.setJSON('dayLifecycle', data);
  }

  loadDayPhase(): {
    dayPhase: string;
    currentDayId: string | null;
    currentDaySeed: number | null;
    rosterAccountIds: string[];
    canaryBlockIds: string[];
  } | undefined {
    return this.getJSON('dayLifecycle');
  }

  clearDayPhase(): void {
    this.delete('dayLifecycle');
  }
}

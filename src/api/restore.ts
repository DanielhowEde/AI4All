/**
 * Restore API state from SQLite after server restart.
 */

import { ApiState, createApiState } from './state';
import { DayPhase, LinkedDevice } from './types';
import type { SqliteStores } from '../persistence/sqlite';
import { createEmptyNetworkState } from '../services/serviceTypes';

export async function restoreApiState(sqliteStores: SqliteStores): Promise<ApiState> {
  // 1. Load latest finalized state
  const latestSnapshot = await sqliteStores.state.loadLatestSnapshot();
  let networkState = createEmptyNetworkState();

  if (latestSnapshot) {
    const saved = await sqliteStores.state.loadState(latestSnapshot.dayId);
    if (saved) {
      networkState = saved;
    }
  }

  // 2. Create base state
  const state = createApiState({
    event: sqliteStores.event,
    state: sqliteStores.state,
    assignment: sqliteStores.assignment,
    submission: sqliteStores.submission,
  });

  state.networkState = networkState;
  state.kvStore = sqliteStores.kv;
  state.balanceStore = sqliteStores.balance;

  // 3. Restore nodeKeys
  state.nodeKeys = sqliteStores.kv.loadNodeKeys();

  // 4. Restore devices
  const { devices, accountDevices } = sqliteStores.kv.loadDevices();
  state.devices = devices as Map<string, LinkedDevice>;
  state.accountDevices = accountDevices;

  // 5. Restore day lifecycle
  const lifecycle = sqliteStores.kv.loadDayPhase();
  if (lifecycle && lifecycle.dayPhase === 'ACTIVE' && lifecycle.currentDayId) {
    state.dayPhase = lifecycle.dayPhase as DayPhase;
    state.currentDayId = lifecycle.currentDayId;
    state.currentDaySeed = lifecycle.currentDaySeed;
    state.currentRosterAccountIds = lifecycle.rosterAccountIds;
    state.currentCanaryBlockIds = new Set(lifecycle.canaryBlockIds);

    // Restore assignments from SQLite
    state.currentDayAssignments = await sqliteStores.assignment.getByDay(lifecycle.currentDayId);

    // Restore pending submissions
    state.pendingSubmissions = await sqliteStores.submission.listByDay(lifecycle.currentDayId);
  }

  return state;
}

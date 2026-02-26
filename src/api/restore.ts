/**
 * Restore API state from file-based stores after server restart.
 */

import { ApiState, createApiState } from './state';
import { DayPhase, LinkedDevice } from './types';
import type { FileStores } from '../persistence/file';
import { createEmptyNetworkState } from '../services/serviceTypes';

export async function restoreApiState(fileStores: FileStores): Promise<ApiState> {
  // 1. Load latest finalized state
  const latestSnapshot = await fileStores.state.loadLatestSnapshot();
  let networkState = createEmptyNetworkState();

  if (latestSnapshot) {
    const saved = await fileStores.state.loadState(latestSnapshot.dayId);
    if (saved) {
      networkState = saved;
    }
  }

  // 2. Create base state
  const state = createApiState({
    event: fileStores.event,
    state: fileStores.state,
    assignment: fileStores.assignment,
    submission: fileStores.submission,
  });

  state.networkState = networkState;
  state.operationalStore = fileStores.operational;
  state.balanceLedger = fileStores.balance;

  // 3. Restore publicKeys
  state.publicKeys = fileStores.operational.loadPublicKeys();

  // 4. Restore devices
  const { devices, accountDevices } = fileStores.operational.loadDevices();
  state.devices = devices as Map<string, LinkedDevice>;
  state.accountDevices = accountDevices;

  // 5. Restore day lifecycle
  const lifecycle = fileStores.operational.loadDayPhase();
  if (lifecycle && lifecycle.dayPhase === 'ACTIVE' && lifecycle.currentDayId) {
    state.dayPhase = lifecycle.dayPhase as DayPhase;
    state.currentDayId = lifecycle.currentDayId;
    state.currentDaySeed = lifecycle.currentDaySeed;
    state.currentRosterAccountIds = lifecycle.rosterAccountIds;
    state.currentCanaryBlockIds = new Set(lifecycle.canaryBlockIds);

    // Restore assignments from file store
    state.currentDayAssignments = await fileStores.assignment.getByDay(lifecycle.currentDayId);

    // Restore pending submissions
    state.pendingSubmissions = await fileStores.submission.listByDay(lifecycle.currentDayId);
  }

  return state;
}

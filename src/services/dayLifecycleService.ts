/**
 * Shared day lifecycle logic used by both admin routes and the scheduler.
 */

import {
  ApiState,
  computeRosterHash,
  computeDaySeed,
  formatDayId,
  resetDayState,
} from '../api/state';
import { DEFAULT_REWARD_CONFIG, DEFAULT_BLOCK_ASSIGNMENT_CONFIG } from '../types';
import { DEFAULT_CANARY_CONFIG, seededRandom } from '../canaryGenerator';
import { assignDailyWork } from './workAssignmentService';
import { persistDay } from '../persistence/persistDay';
import { toMicroUnits } from '../fixedPoint';

export interface DayStartResult {
  dayId: string;
  seed: number;
  rosterHash: string;
  activeContributors: number;
  totalBlocks: number;
}

export interface FinalizeResult {
  dayId: string;
  verification: { valid: boolean; error?: string };
  summary: {
    activeContributors: number;
    totalEmissions: number;
    basePoolTotal: number;
    performancePoolTotal: number;
  };
}

/**
 * Start a new day: lock roster, compute seed, generate assignments.
 * Mutates state directly. Returns summary.
 */
export function startNewDay(state: ApiState, dayId?: string): DayStartResult {
  const resolvedDayId = dayId || formatDayId(new Date());

  // Lock roster
  const accountIds = Array.from(state.networkState.contributors.keys()).sort();
  state.currentRosterAccountIds = accountIds;

  // Compute deterministic seed
  const rosterHash = computeRosterHash(accountIds);
  const seed = computeDaySeed(resolvedDayId, rosterHash);
  state.currentDaySeed = seed;

  // Generate assignments
  const allContributors = Array.from(state.networkState.contributors.values());
  const random = seededRandom(seed);
  const { assignments, canaryBlockIds } = assignDailyWork(
    allContributors,
    DEFAULT_BLOCK_ASSIGNMENT_CONFIG,
    DEFAULT_CANARY_CONFIG,
    new Date(),
    random
  );

  // Store in state
  state.currentDayAssignments = assignments;
  state.currentCanaryBlockIds = canaryBlockIds;
  state.currentDayId = resolvedDayId;
  state.dayPhase = 'ACTIVE';

  // Persist day lifecycle to kv store if available
  if (state.kvStore) {
    state.kvStore.saveDayPhase({
      dayPhase: 'ACTIVE',
      currentDayId: resolvedDayId,
      currentDaySeed: seed,
      rosterAccountIds: accountIds,
      canaryBlockIds: Array.from(canaryBlockIds),
    });
  }

  const totalBlocks = assignments.reduce((sum, a) => sum + a.blockIds.length, 0);

  return {
    dayId: resolvedDayId,
    seed,
    rosterHash,
    activeContributors: allContributors.length,
    totalBlocks,
  };
}

/**
 * Finalize the current day: process submissions, distribute rewards, persist.
 * Mutates state. Returns summary.
 */
export async function finalizeCurrent(state: ApiState): Promise<FinalizeResult> {
  const dayId = state.currentDayId!;
  state.dayPhase = 'FINALIZING';

  const currentTime = new Date(`${dayId}T12:00:00Z`);
  const config = {
    rewardConfig: DEFAULT_REWARD_CONFIG,
    blockAssignmentConfig: DEFAULT_BLOCK_ASSIGNMENT_CONFIG,
    canaryConfig: DEFAULT_CANARY_CONFIG,
    currentTime,
    random: state.currentDaySeed !== null ? seededRandom(state.currentDaySeed) : undefined,
  };

  const { newState, result } = await persistDay(
    state.networkState,
    state.pendingSubmissions,
    config,
    state.stores
  );

  // Update network state
  state.networkState = newState;

  // Credit rewards to balance ledger
  if (state.balanceStore && result.rewardDistribution.rewards.length > 0) {
    const credits = result.rewardDistribution.rewards
      .filter(r => r.totalReward > 0)
      .map(r => ({
        accountId: r.accountId,
        amountMicro: toMicroUnits(r.totalReward),
      }));
    if (credits.length > 0) {
      state.balanceStore.creditRewards(dayId, credits);
    }
  }

  // Reset day state
  resetDayState(state);

  // Clear day lifecycle in kv store
  if (state.kvStore) {
    state.kvStore.clearDayPhase();
    state.kvStore.saveNodeKeys(state.nodeKeys);
  }

  return {
    dayId,
    verification: result.verification,
    summary: {
      activeContributors: result.rewardDistribution.activeContributorCount,
      totalEmissions: result.rewardDistribution.totalEmissions,
      basePoolTotal: result.rewardDistribution.basePoolTotal,
      performancePoolTotal: result.rewardDistribution.performancePoolTotal,
    },
  };
}

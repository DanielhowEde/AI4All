import * as crypto from 'crypto';
import { NetworkState, BlockSubmission, createEmptyNetworkState } from '../services/serviceTypes';
import { BlockAssignment } from '../types';
import { IEventStore, IStateStore, IAssignmentStore, ISubmissionStore } from '../persistence/interfaces';
import { DayPhase, SubmissionResultItem } from './types';

/**
 * API state container for the HTTP server
 */
export interface ApiState {
  // Core network state
  networkState: NetworkState;

  // Storage backends
  stores: {
    event: IEventStore;
    state: IStateStore;
    assignment: IAssignmentStore;
    submission: ISubmissionStore;
  };

  // Day lifecycle
  dayPhase: DayPhase;
  currentDayId: string | null;
  currentDayAssignments: BlockAssignment[];
  currentDaySeed: number | null;
  currentRosterAccountIds: string[]; // Locked at day start

  // Canaries for current day
  currentCanaryBlockIds: Set<string>;

  // Idempotency: "accountId:blockId:dayId" → cached result
  processedSubmissions: Map<string, SubmissionResultItem>;
  pendingSubmissions: BlockSubmission[];

  // Minimal auth: accountId → nodeKey
  nodeKeys: Map<string, string>;
}

/**
 * Create initial API state
 */
export function createApiState(stores: {
  event: IEventStore;
  state: IStateStore;
  assignment: IAssignmentStore;
  submission: ISubmissionStore;
}): ApiState {
  return {
    networkState: createEmptyNetworkState(),
    stores,
    dayPhase: 'IDLE',
    currentDayId: null,
    currentDayAssignments: [],
    currentDaySeed: null,
    currentRosterAccountIds: [],
    currentCanaryBlockIds: new Set(),
    processedSubmissions: new Map(),
    pendingSubmissions: [],
    nodeKeys: new Map(),
  };
}

/**
 * Format a Date to YYYY-MM-DD UTC dayId
 */
export function formatDayId(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Get today's dayId in UTC
 */
export function getTodayDayId(): string {
  return formatDayId(new Date());
}

/**
 * Compute deterministic roster hash from sorted account IDs
 * This excludes volatile fields like timestamps and counters
 */
export function computeRosterHash(accountIds: string[]): string {
  const sorted = [...accountIds].sort();
  const data = sorted.join(',');
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Compute deterministic day seed from dayId and roster hash
 * Returns a numeric seed for seededRandom()
 */
export function computeDaySeed(dayId: string, rosterHash: string): number {
  const combined = `${dayId}:${rosterHash}`;
  const hash = crypto.createHash('sha256').update(combined).digest('hex');
  // Take first 8 hex chars (32 bits) and convert to number
  return parseInt(hash.substring(0, 8), 16);
}

/**
 * Build idempotency key for submission caching
 */
export function buildIdempotencyKey(accountId: string, blockId: string, dayId: string): string {
  return `${accountId}:${blockId}:${dayId}`;
}

/**
 * Check if an account is in the locked roster for current day
 */
export function isInRoster(state: ApiState, accountId: string): boolean {
  return state.currentRosterAccountIds.includes(accountId);
}

/**
 * Get assignments for a specific account
 */
export function getAssignmentsForAccount(
  state: ApiState,
  accountId: string
): Array<{ blockId: string; batchNumber: number }> {
  const assignments = state.currentDayAssignments.filter(a => a.contributorId === accountId);
  const result: Array<{ blockId: string; batchNumber: number }> = [];
  for (const assignment of assignments) {
    for (const blockId of assignment.blockIds) {
      result.push({ blockId, batchNumber: assignment.batchNumber });
    }
  }
  return result;
}

/**
 * Check if a block was assigned to an account
 */
export function isBlockAssignedTo(state: ApiState, accountId: string, blockId: string): boolean {
  const assignments = state.currentDayAssignments.filter(a => a.contributorId === accountId);
  for (const assignment of assignments) {
    if (assignment.blockIds.includes(blockId)) {
      return true;
    }
  }
  return false;
}

/**
 * Reset day state (called after finalization or on crash recovery)
 */
export function resetDayState(state: ApiState): void {
  state.dayPhase = 'IDLE';
  state.currentDayId = null;
  state.currentDayAssignments = [];
  state.currentDaySeed = null;
  state.currentRosterAccountIds = [];
  state.currentCanaryBlockIds = new Set();
  state.processedSubmissions.clear();
  state.pendingSubmissions = [];
}

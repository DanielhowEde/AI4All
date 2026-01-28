import { DomainEvent } from './eventTypes';
import { IEventStore, IStateStore, StateSnapshot } from './interfaces';
import { projectState } from './stateProjection';
import { computeStateHash, computeRewardHash, computeEventHash } from './eventBuilder';
import { createEmptyNetworkState, NetworkState } from '../services/serviceTypes';

export interface ReplayResult {
  dayId: string;
  replayedStateHash: string;
  replayedRewardHash: string;
  storedSnapshot: StateSnapshot | undefined;
  stateMatch: boolean;
  rewardsMatch: boolean;
  hashChainValid: boolean;
}

export interface ReplayReport {
  days: ReplayResult[];
  allValid: boolean;
  firstFailure?: string;
}

/**
 * Verify the hash chain of a sequence of events.
 */
export function verifyHashChain(
  events: DomainEvent[],
  expectedPrevHash?: string
): { valid: boolean; brokenAt?: number; error?: string } {
  if (events.length === 0) {
    return { valid: true };
  }

  // Check first event's prevHash if expected is provided
  if (expectedPrevHash !== undefined && events[0].prevEventHash !== expectedPrevHash) {
    return {
      valid: false,
      brokenAt: 0,
      error: `First event prevEventHash mismatch: expected ${expectedPrevHash}, got ${events[0].prevEventHash}`,
    };
  }

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    // Verify this event's hash
    const expectedHash = computeEventHash({
      eventId: event.eventId,
      dayId: event.dayId,
      sequenceNumber: event.sequenceNumber,
      timestamp: event.timestamp,
      eventType: event.eventType,
      actorId: event.actorId,
      payload: event.payload,
      prevEventHash: event.prevEventHash,
    });

    if (event.eventHash !== expectedHash) {
      return {
        valid: false,
        brokenAt: i,
        error: `Event ${i} hash mismatch: expected ${expectedHash}, got ${event.eventHash}`,
      };
    }

    // Verify chain link (except first)
    if (i > 0 && event.prevEventHash !== events[i - 1].eventHash) {
      return {
        valid: false,
        brokenAt: i,
        error: `Event ${i} chain broken: prevEventHash doesn't match previous event's hash`,
      };
    }
  }

  return { valid: true };
}

function extractRewardsFromEvents(events: DomainEvent[]): Array<{ accountId: string; totalReward: number }> {
  const dayFinalized = events.find(e => e.eventType === 'DAY_FINALIZED');
  if (!dayFinalized) return [];

  const payload = dayFinalized.payload as {
    rewards: Array<{ accountId: string; totalReward: number }>;
  };
  return payload.rewards ?? [];
}

/**
 * Replay a single day: rebuild state from events and verify hashes.
 */
export async function replayDay(
  dayId: string,
  stores: { event: IEventStore; state: IStateStore },
  initialState?: NetworkState
): Promise<ReplayResult> {
  // Load events for this day
  const events = await stores.event.queryByDay(dayId);

  // Verify hash chain
  const chainResult = verifyHashChain(events);

  // Project state from events
  const baseState = initialState ?? createEmptyNetworkState();
  const replayedState = projectState(events, baseState);

  // Compute hashes
  const replayedStateHash = computeStateHash(replayedState);
  const rewards = extractRewardsFromEvents(events);
  const replayedRewardHash = computeRewardHash(rewards);

  // Load stored snapshot
  const storedSnapshot = await stores.state.loadSnapshot(dayId);

  // Compare
  const stateMatch = storedSnapshot ? replayedStateHash === storedSnapshot.stateHash : true;
  const rewardsMatch = storedSnapshot ? replayedRewardHash === storedSnapshot.rewardHash : true;

  return {
    dayId,
    replayedStateHash,
    replayedRewardHash,
    storedSnapshot,
    stateMatch,
    rewardsMatch,
    hashChainValid: chainResult.valid,
  };
}

/**
 * Generate day IDs in a range (inclusive).
 */
function generateDayRange(fromDayId: string, toDayId: string): string[] {
  const days: string[] = [];
  const current = new Date(fromDayId);
  const end = new Date(toDayId);

  while (current <= end) {
    days.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }

  return days;
}

/**
 * Replay a range of days and produce a report.
 *
 * @param fromDayId - Start day (inclusive)
 * @param toDayId - End day (inclusive)
 * @param stores - Event and state stores
 * @param initialState - Starting state before the first day (required for proper verification)
 */
export async function replayDayRange(
  fromDayId: string,
  toDayId: string,
  stores: { event: IEventStore; state: IStateStore },
  initialState?: NetworkState
): Promise<ReplayReport> {
  const dayIds = generateDayRange(fromDayId, toDayId);
  const results: ReplayResult[] = [];
  let allValid = true;
  let firstFailure: string | undefined;
  let currentState: NetworkState | undefined = initialState;

  for (const dayId of dayIds) {
    const result = await replayDay(dayId, stores, currentState);
    results.push(result);

    const isValid = result.hashChainValid && result.stateMatch && result.rewardsMatch;
    if (!isValid && allValid) {
      allValid = false;
      firstFailure = dayId;
    }

    // Load state for next day (use stored state if available for continuity)
    currentState = await stores.state.loadState(dayId);
    if (!currentState) {
      // Fall back to projected state
      const events = await stores.event.queryByDay(dayId);
      currentState = projectState(events, currentState ?? createEmptyNetworkState());
    }
  }

  return {
    days: results,
    allValid,
    firstFailure,
  };
}

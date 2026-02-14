import {
  NetworkState,
  DayConfig,
  DayResult,
  BlockSubmission,
} from '../services/serviceTypes';
import { simulateDay } from '../services/simulateDay';
import { GENESIS_HASH } from './eventTypes';
import {
  IEventStore,
  IStateStore,
  IAssignmentStore,
  ISubmissionStore,
  StateSnapshot,
} from './interfaces';
import { buildDayEvents, computeStateHash, computeRewardHash } from './eventBuilder';

function formatDayId(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Production wrapper: run simulateDay() then persist all artifacts to stores.
 */
export async function persistDay(
  state: NetworkState,
  submissions: BlockSubmission[],
  config: DayConfig,
  stores: {
    event: IEventStore;
    state: IStateStore;
    assignment: IAssignmentStore;
    submission: ISubmissionStore;
  }
): Promise<{ newState: NetworkState; result: DayResult }> {
  // 1. Run pure simulation
  const { newState, result } = simulateDay(state, submissions, config);

  // 2. Get previous event hash
  const lastEvent = await stores.event.getLastEvent();
  const prevEventHash = lastEvent?.eventHash ?? GENESIS_HASH;

  // 3. Build events
  const dayId = formatDayId(config.currentTime);
  const timestamp = config.currentTime.toISOString();
  const events = buildDayEvents(dayId, result, submissions, prevEventHash, timestamp);

  // 4. Persist events, assignments, and submissions in parallel (independent stores)
  await Promise.all([
    stores.event.append(events),
    stores.assignment.putAssignments(dayId, result.assignments),
    stores.submission.putSubmissions(dayId, submissions),
  ]);

  // 7. Compute hashes
  const stateHash = computeStateHash(newState);
  const rewardHash = computeRewardHash(result.rewardDistribution.rewards);
  const lastDayEvent = events[events.length - 1];

  // 8. Save snapshot
  const snapshot: StateSnapshot = {
    dayId,
    dayNumber: newState.dayNumber,
    stateHash,
    lastEventHash: lastDayEvent.eventHash,
    rewardHash,
    contributorCount: newState.contributors.size,
    createdAt: timestamp,
  };
  await stores.state.saveSnapshot(snapshot);

  // 9. Save full state for fast restart
  await stores.state.saveState(dayId, newState);

  return { newState, result };
}

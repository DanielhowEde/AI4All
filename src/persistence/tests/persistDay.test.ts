import { persistDay } from '../persistDay';
import { createInMemoryStores } from '../inMemoryStores';
import {
  createEmptyNetworkState,
  NetworkState,
  DayConfig,
  BlockSubmission,
} from '../../services/serviceTypes';
import { registerNode } from '../../services/nodeService';
import { BlockType, Contributor, DEFAULT_REWARD_CONFIG, DEFAULT_BLOCK_ASSIGNMENT_CONFIG } from '../../types';
import { DEFAULT_CANARY_CONFIG, seededRandom } from '../../canaryGenerator';

const baseTime = new Date('2026-01-28T12:00:00Z');

function makeDayConfig(currentTime: Date = baseTime, seed: number = 42): DayConfig {
  return {
    rewardConfig: DEFAULT_REWARD_CONFIG,
    blockAssignmentConfig: DEFAULT_BLOCK_ASSIGNMENT_CONFIG,
    canaryConfig: DEFAULT_CANARY_CONFIG,
    currentTime,
    random: seededRandom(seed),
  };
}

function addActiveContributor(
  state: NetworkState,
  id: string,
  blockCount: number = 10
): NetworkState {
  if (!state.contributors.has(id)) {
    const { state: s } = registerNode(state, { accountId: id }, baseTime);
    state = s;
  }

  const contributor = state.contributors.get(id)!;
  const blocks = Array.from({ length: blockCount }, (_, i) => ({
    blockType: BlockType.INFERENCE as BlockType,
    resourceUsage: 1.0,
    difficultyMultiplier: 1.0,
    validationPassed: true,
    timestamp: new Date(baseTime.getTime() - i * 60_000),
    isCanary: false,
  }));

  const updated: Contributor = {
    ...contributor,
    completedBlocks: [...contributor.completedBlocks, ...blocks],
  };

  const newContributors = new Map(state.contributors);
  newContributors.set(id, updated);
  return { ...state, contributors: newContributors };
}

describe('persistDay', () => {
  it('should persist events to event store', async () => {
    const stores = createInMemoryStores();
    let state = createEmptyNetworkState();
    state = addActiveContributor(state, 'alice', 10);

    const config = makeDayConfig();
    await persistDay(state, [], config, stores);

    const events = await stores.event.queryByDay('2026-01-28');
    expect(events.length).toBeGreaterThan(0);

    const eventTypes = events.map(e => e.eventType);
    expect(eventTypes).toContain('WORK_ASSIGNED');
    expect(eventTypes).toContain('DAY_FINALIZED');
    expect(eventTypes).toContain('REWARDS_COMMITTED');
  });

  it('should persist assignments to assignment store', async () => {
    const stores = createInMemoryStores();
    let state = createEmptyNetworkState();
    state = addActiveContributor(state, 'alice', 10);

    await persistDay(state, [], makeDayConfig(), stores);

    const assignments = await stores.assignment.getByDay('2026-01-28');
    expect(assignments.length).toBeGreaterThan(0);
    expect(assignments[0].contributorId).toBe('alice');
  });

  it('should persist submissions to submission store', async () => {
    const stores = createInMemoryStores();
    let state = createEmptyNetworkState();
    state = addActiveContributor(state, 'alice', 10);

    const submissions: BlockSubmission[] = [
      {
        contributorId: 'alice',
        blockId: 'b1',
        blockType: BlockType.INFERENCE,
        resourceUsage: 0.8,
        difficultyMultiplier: 1.0,
        validationPassed: true,
        timestamp: baseTime,
      },
    ];

    await persistDay(state, submissions, makeDayConfig(), stores);

    const stored = await stores.submission.listByDay('2026-01-28');
    expect(stored).toHaveLength(1);
    expect(stored[0].blockId).toBe('b1');
  });

  it('should save snapshot with correct hashes', async () => {
    const stores = createInMemoryStores();
    let state = createEmptyNetworkState();
    state = addActiveContributor(state, 'alice', 10);

    await persistDay(state, [], makeDayConfig(), stores);

    const snapshot = await stores.state.loadSnapshot('2026-01-28');
    expect(snapshot).toBeDefined();
    expect(snapshot!.dayId).toBe('2026-01-28');
    expect(snapshot!.dayNumber).toBe(1);
    expect(snapshot!.stateHash).toHaveLength(64);
    expect(snapshot!.rewardHash).toHaveLength(64);
    expect(snapshot!.lastEventHash).toHaveLength(64);
  });

  it('should save full state for fast restart', async () => {
    const stores = createInMemoryStores();
    let state = createEmptyNetworkState();
    state = addActiveContributor(state, 'alice', 10);

    await persistDay(state, [], makeDayConfig(), stores);

    const loadedState = await stores.state.loadState('2026-01-28');
    expect(loadedState).toBeDefined();
    expect(loadedState!.dayNumber).toBe(1);
    expect(loadedState!.contributors.has('alice')).toBe(true);
  });

  it('should return same result as simulateDay', async () => {
    const stores = createInMemoryStores();
    let state = createEmptyNetworkState();
    state = addActiveContributor(state, 'alice', 10);

    const { newState, result } = await persistDay(state, [], makeDayConfig(), stores);

    expect(newState.dayNumber).toBe(1);
    expect(result.rewardDistribution.rewards.length).toBeGreaterThan(0);
    expect(result.verification.valid).toBe(true);
  });

  it('should chain events across multiple days', async () => {
    const stores = createInMemoryStores();
    let state = createEmptyNetworkState();
    state = addActiveContributor(state, 'alice', 10);

    // Day 1
    const day1Config = makeDayConfig(new Date('2026-01-28T12:00:00Z'), 1);
    const { newState: s1 } = await persistDay(state, [], day1Config, stores);

    // Day 2
    const day2Config = makeDayConfig(new Date('2026-01-29T12:00:00Z'), 2);
    await persistDay(s1, [], day2Config, stores);

    const day1Events = await stores.event.queryByDay('2026-01-28');
    const day2Events = await stores.event.queryByDay('2026-01-29');

    // Day 2's first event should chain from day 1's last event
    const day1LastHash = day1Events[day1Events.length - 1].eventHash;
    expect(day2Events[0].prevEventHash).toBe(day1LastHash);
  });
});

import { verifyHashChain, replayDay, replayDayRange } from '../replayRunner';
import { persistDay } from '../persistDay';
import { createInMemoryStores } from '../inMemoryStores';
import { DomainEvent, GENESIS_HASH } from '../eventTypes';
import {
  createEmptyNetworkState,
  NetworkState,
  DayConfig,
} from '../../services/serviceTypes';
import { registerNode } from '../../services/nodeService';
import {
  BlockType,
  Contributor,
  DEFAULT_REWARD_CONFIG,
  DEFAULT_BLOCK_ASSIGNMENT_CONFIG,
} from '../../types';
import { DEFAULT_CANARY_CONFIG, seededRandom } from '../../canaryGenerator';
import { computeEventHash } from '../eventBuilder';

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

function makeEvent(
  dayId: string,
  seq: number,
  prevHash: string
): DomainEvent {
  const partial = {
    eventId: `evt-${dayId}-${seq}`,
    dayId,
    sequenceNumber: seq,
    timestamp: baseTime.toISOString(),
    eventType: 'WORK_ASSIGNED' as const,
    payload: { seq },
    prevEventHash: prevHash,
  };
  return { ...partial, eventHash: computeEventHash(partial) };
}

describe('verifyHashChain', () => {
  it('should pass for valid chain', () => {
    const e0 = makeEvent('2026-01-28', 0, GENESIS_HASH);
    const e1 = makeEvent('2026-01-28', 1, e0.eventHash);
    const e2 = makeEvent('2026-01-28', 2, e1.eventHash);

    const result = verifyHashChain([e0, e1, e2]);
    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBeUndefined();
  });

  it('should fail for broken chain link', () => {
    const e0 = makeEvent('2026-01-28', 0, GENESIS_HASH);
    const e1 = makeEvent('2026-01-28', 1, 'wrong-hash');

    const result = verifyHashChain([e0, e1]);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  it('should fail for tampered event hash', () => {
    const e0 = makeEvent('2026-01-28', 0, GENESIS_HASH);
    e0.eventHash = 'tampered';

    const result = verifyHashChain([e0]);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(0);
  });

  it('should pass for empty events', () => {
    const result = verifyHashChain([]);
    expect(result.valid).toBe(true);
  });

  it('should verify expected prevHash for first event', () => {
    const e0 = makeEvent('2026-01-28', 0, GENESIS_HASH);

    expect(verifyHashChain([e0], GENESIS_HASH).valid).toBe(true);
    expect(verifyHashChain([e0], 'other-hash').valid).toBe(false);
  });
});

describe('replayDay', () => {
  it('should replay and verify a persisted day', async () => {
    const stores = createInMemoryStores();
    let state = createEmptyNetworkState();
    state = addActiveContributor(state, 'alice', 10);
    const initialState = state;

    await persistDay(state, [], makeDayConfig(), stores);

    const result = await replayDay('2026-01-28', stores, initialState);

    expect(result.hashChainValid).toBe(true);
    expect(result.stateMatch).toBe(true);
    expect(result.rewardsMatch).toBe(true);
    expect(result.storedSnapshot).toBeDefined();
  });

  it('should detect hash mismatch if snapshot corrupted', async () => {
    const stores = createInMemoryStores();
    let state = createEmptyNetworkState();
    state = addActiveContributor(state, 'alice', 10);
    const initialState = state;

    await persistDay(state, [], makeDayConfig(), stores);

    // Corrupt the snapshot
    const snapshot = await stores.state.loadSnapshot('2026-01-28');
    await stores.state.saveSnapshot({
      ...snapshot!,
      stateHash: 'corrupted-hash',
    });

    const result = await replayDay('2026-01-28', stores, initialState);

    expect(result.hashChainValid).toBe(true);
    expect(result.stateMatch).toBe(false);
  });

  it('should detect reward hash mismatch', async () => {
    const stores = createInMemoryStores();
    let state = createEmptyNetworkState();
    state = addActiveContributor(state, 'alice', 10);
    const initialState = state;

    await persistDay(state, [], makeDayConfig(), stores);

    // Corrupt the reward hash
    const snapshot = await stores.state.loadSnapshot('2026-01-28');
    await stores.state.saveSnapshot({
      ...snapshot!,
      rewardHash: 'corrupted-reward-hash',
    });

    const result = await replayDay('2026-01-28', stores, initialState);

    expect(result.rewardsMatch).toBe(false);
  });

  it('should handle day with no snapshot gracefully', async () => {
    const stores = createInMemoryStores();

    const result = await replayDay('2026-01-28', stores);

    expect(result.storedSnapshot).toBeUndefined();
    expect(result.stateMatch).toBe(true); // No snapshot to compare
    expect(result.rewardsMatch).toBe(true);
  });
});

describe('replayDayRange', () => {
  it('should replay multiple days and verify hash chain', async () => {
    const stores = createInMemoryStores();
    let state = createEmptyNetworkState();
    state = addActiveContributor(state, 'alice', 10);

    // Day 1
    const { newState: s1 } = await persistDay(
      state,
      [],
      makeDayConfig(new Date('2026-01-28T12:00:00Z'), 1),
      stores
    );

    // Day 2
    await persistDay(
      s1,
      [],
      makeDayConfig(new Date('2026-01-29T12:00:00Z'), 2),
      stores
    );

    // Replay verifies hash chain integrity (state/reward match requires stored initial state)
    const report = await replayDayRange('2026-01-28', '2026-01-29', stores);

    expect(report.days).toHaveLength(2);
    // Hash chain should be valid across both days
    expect(report.days[0].hashChainValid).toBe(true);
    expect(report.days[1].hashChainValid).toBe(true);
  });

  it('should verify state match when initial state provided', async () => {
    const stores = createInMemoryStores();
    let state = createEmptyNetworkState();
    state = addActiveContributor(state, 'alice', 10);
    const initialState = state;

    // Day 1
    await persistDay(
      state,
      [],
      makeDayConfig(new Date('2026-01-28T12:00:00Z'), 1),
      stores
    );

    // Replay with same initial state should match
    const result = await replayDay('2026-01-28', stores, initialState);

    expect(result.hashChainValid).toBe(true);
    expect(result.stateMatch).toBe(true);
    expect(result.rewardsMatch).toBe(true);
  });

  it('should detect tampered events', async () => {
    const stores = createInMemoryStores();
    let state = createEmptyNetworkState();
    state = addActiveContributor(state, 'alice', 10);

    await persistDay(
      state,
      [],
      makeDayConfig(new Date('2026-01-28T12:00:00Z'), 1),
      stores
    );

    // Tamper with an event's hash
    const events = await stores.event.queryByDay('2026-01-28');
    if (events.length > 0) {
      events[0].eventHash = 'tampered-hash';
    }

    const chainResult = verifyHashChain(events);
    expect(chainResult.valid).toBe(false);
  });
});

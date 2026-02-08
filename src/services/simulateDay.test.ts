import {
  BlockType,
  Contributor,
  DEFAULT_REWARD_CONFIG,
  DEFAULT_BLOCK_ASSIGNMENT_CONFIG,
} from '../types';
import { DEFAULT_CANARY_CONFIG, seededRandom } from '../canaryGenerator';
import { simulateDay } from './simulateDay';
import { registerNode } from './nodeService';
import {
  createEmptyNetworkState,
  NetworkState,
  DayConfig,
  BlockSubmission,
} from './serviceTypes';

const baseTime = new Date('2026-01-28T12:00:00Z');

function makeDayConfig(
  currentTime: Date = baseTime,
  seed: number = 42
): DayConfig {
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
  // Register if not exists
  if (!state.contributors.has(id)) {
    const { state: s } = registerNode(state, { accountId: id }, baseTime);
    state = s;
  }

  // Add completed blocks to make active
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

function makeSubmissions(
  contributorId: string,
  blockIds: string[],
  canaryBlockIds: Set<string>,
  timestamp: Date
): BlockSubmission[] {
  return blockIds.map(blockId => ({
    contributorId,
    blockId,
    blockType: BlockType.INFERENCE,
    resourceUsage: 0.8,
    difficultyMultiplier: 1.0,
    validationPassed: true,
    canaryAnswerCorrect: canaryBlockIds.has(blockId) ? true : undefined,
    timestamp,
  }));
}

describe('simulateDay', () => {
  it('should orchestrate a full day cycle', () => {
    let state = createEmptyNetworkState();
    state = addActiveContributor(state, 'alice', 10);
    state = addActiveContributor(state, 'bob', 10);

    const config = makeDayConfig();

    // First run simulateDay with empty submissions (just assignments + rewards)
    const { newState, result } = simulateDay(state, [], config);

    expect(result.assignments.length).toBeGreaterThan(0);
    expect(result.canaryBlockIds.length).toBeGreaterThan(0);
    expect(result.rewardDistribution.rewards.length).toBeGreaterThan(0);
    expect(result.verification.valid).toBe(true);
    expect(newState.dayNumber).toBe(1);
    expect(result.audit.length).toBeGreaterThan(0);
  });

  it('should process submissions and update contributors', () => {
    let state = createEmptyNetworkState();
    state = addActiveContributor(state, 'alice', 10);

    const config = makeDayConfig();

    // Get assignments first to know block IDs
    const { result: dayResult } = simulateDay(state, [], config);
    const aliceBlocks = dayResult.assignments
      .filter(a => a.contributorId === 'alice')
      .flatMap(a => a.blockIds);

    // Now submit those blocks
    const canaryIds = new Set(dayResult.canaryBlockIds);
    const submissions = makeSubmissions('alice', aliceBlocks, canaryIds, baseTime);

    const { newState } = simulateDay(state, submissions, makeDayConfig(baseTime, 42));

    const alice = newState.contributors.get('alice')!;
    expect(alice.completedBlocks.length).toBeGreaterThan(10); // original 10 + submitted
  });

  it('should not mutate original state', () => {
    let state = createEmptyNetworkState();
    state = addActiveContributor(state, 'alice', 10);

    const originalDayNumber = state.dayNumber;
    const originalContributorCount = state.contributors.size;

    simulateDay(state, [], makeDayConfig());

    expect(state.dayNumber).toBe(originalDayNumber);
    expect(state.contributors.size).toBe(originalContributorCount);
  });

  it('should carry state forward across multiple days', () => {
    let state = createEmptyNetworkState();
    state = addActiveContributor(state, 'alice', 10);
    state = addActiveContributor(state, 'bob', 10);

    // Day 1
    const day1Config = makeDayConfig(new Date('2026-01-28T12:00:00Z'), 1);
    const { newState: s1, result: r1 } = simulateDay(state, [], day1Config);
    expect(s1.dayNumber).toBe(1);

    // Day 2
    const day2Config = makeDayConfig(new Date('2026-01-29T12:00:00Z'), 2);
    const { newState: s2, result: r2 } = simulateDay(s1, [], day2Config);
    expect(s2.dayNumber).toBe(2);

    // Audit log grows
    expect(s2.auditLog.length).toBeGreaterThan(s1.auditLog.length);

    // Both days produce rewards
    expect(r1.rewardDistribution.rewards.length).toBeGreaterThan(0);
    expect(r2.rewardDistribution.rewards.length).toBeGreaterThan(0);
  });

  it('should handle canary failure blocking contributor next day', async () => {
    let state = createEmptyNetworkState();
    state = addActiveContributor(state, 'alice', 10);
    state = addActiveContributor(state, 'bob', 10);

    // Day 1: alice fails a canary
    const failedSubmission: BlockSubmission = {
      contributorId: 'alice',
      blockId: 'canary-block-1',
      blockType: BlockType.INFERENCE,
      resourceUsage: 0.8,
      difficultyMultiplier: 1.0,
      validationPassed: true,
      canaryAnswerCorrect: false, // FAILED
      timestamp: baseTime,
    };

    // Force this block to be a canary by including it in submissions
    // and using a state where it's treated as canary
    const canarySet = new Set(['canary-block-1']);

    // Process directly via service to set up the failure
    const { processBatchSubmissions } = await import('./submissionService');
    const { updatedContributors } = processBatchSubmissions(
      state.contributors,
      [failedSubmission],
      canarySet,
      DEFAULT_REWARD_CONFIG
    );

    const failState: NetworkState = {
      ...state,
      contributors: updatedContributors,
    };

    // Verify alice is now penalized
    const alice = failState.contributors.get('alice')!;
    expect(alice.canaryFailures).toBe(1);
    expect(alice.lastCanaryFailureTime).toEqual(baseTime);

    // Day 2 (12 hours later - still within 24h block)
    const day2Time = new Date(baseTime.getTime() + 12 * 60 * 60 * 1000);
    const day2Config = makeDayConfig(day2Time, 99);
    const { result: day2 } = simulateDay(failState, [], day2Config);

    // Alice should be excluded from rewards (blocked by canary failure)
    const aliceReward = day2.rewardDistribution.rewards.find(
      r => r.accountId === 'alice'
    );
    expect(aliceReward).toBeUndefined();

    // Bob should still get rewards
    const bobReward = day2.rewardDistribution.rewards.find(
      r => r.accountId === 'bob'
    );
    expect(bobReward).toBeDefined();
    expect(bobReward!.totalReward).toBeGreaterThan(0);
  });

  it('should produce reward sums matching daily emissions', () => {
    let state = createEmptyNetworkState();
    state = addActiveContributor(state, 'alice', 20);
    state = addActiveContributor(state, 'bob', 15);
    state = addActiveContributor(state, 'charlie', 10);

    const { result } = simulateDay(state, [], makeDayConfig());

    const totalRewards = result.rewardDistribution.rewards.reduce(
      (sum: number, r) => sum + r.totalReward,
      0
    );

    expect(totalRewards).toBeCloseTo(DEFAULT_REWARD_CONFIG.dailyEmissions, 2);
  });

  it('should be deterministic with same seed', () => {
    let state = createEmptyNetworkState();
    state = addActiveContributor(state, 'alice', 10);
    state = addActiveContributor(state, 'bob', 10);

    const { result: r1 } = simulateDay(state, [], makeDayConfig(baseTime, 42));
    const { result: r2 } = simulateDay(state, [], makeDayConfig(baseTime, 42));

    expect(r1.assignments.length).toBe(r2.assignments.length);
    expect(r1.rewardDistribution.rewards.length).toBe(
      r2.rewardDistribution.rewards.length
    );

    for (let i = 0; i < r1.rewardDistribution.rewards.length; i++) {
      expect(r1.rewardDistribution.rewards[i].totalReward).toBe(
        r2.rewardDistribution.rewards[i].totalReward
      );
    }
  });

  it('should handle empty network gracefully', () => {
    const state = createEmptyNetworkState();
    const { newState, result } = simulateDay(state, [], makeDayConfig());

    expect(result.assignments).toEqual([]);
    expect(result.rewardDistribution.rewards).toEqual([]);
    expect(newState.dayNumber).toBe(1);
  });

  it('should increment day number each simulation', () => {
    let state = createEmptyNetworkState();
    state = addActiveContributor(state, 'alice', 10);

    const { newState: s1 } = simulateDay(state, [], makeDayConfig());
    const { newState: s2 } = simulateDay(s1, [], makeDayConfig());
    const { newState: s3 } = simulateDay(s2, [], makeDayConfig());

    expect(s1.dayNumber).toBe(1);
    expect(s2.dayNumber).toBe(2);
    expect(s3.dayNumber).toBe(3);
  });
});

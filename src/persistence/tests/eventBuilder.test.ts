import {
  buildDayEvents,
  computeEventHash,
  computeStateHash,
  computeRewardHash,
} from '../eventBuilder';
import { GENESIS_HASH } from '../eventTypes';
import {
  DayResult,
  BlockSubmission,
  createEmptyNetworkState,
} from '../../services/serviceTypes';
import { BlockType, RewardDistribution, DEFAULT_REWARD_CONFIG } from '../../types';

const baseTime = new Date('2026-01-28T12:00:00Z');
const dayId = '2026-01-28';

function makeMinimalDayResult(): DayResult {
  const distribution: RewardDistribution = {
    date: baseTime,
    config: DEFAULT_REWARD_CONFIG,
    totalEmissions: 1000,
    basePoolTotal: 500,
    performancePoolTotal: 500,
    luckPoolTotal: 0,
    activeContributorCount: 1,
    rewards: [
      {
        accountId: 'alice',
        basePoolReward: 500,
        performancePoolReward: 500,
        luckPoolReward: 0,
        totalReward: 1000,
      },
    ],
  };

  return {
    assignments: [
      {
        contributorId: 'alice',
        blockIds: ['b1', 'b2'],
        assignedAt: baseTime,
        batchNumber: 1,
      },
    ],
    canaryBlockIds: ['b2'],
    submissionResults: [],
    updatedContributors: new Map(),
    rewardDistribution: distribution,
    audit: [],
    verification: { valid: true },
  };
}

describe('computeEventHash', () => {
  it('should produce deterministic hashes', () => {
    const event = {
      eventId: 'evt-1',
      dayId,
      sequenceNumber: 0,
      timestamp: '2026-01-28T12:00:00.000Z',
      eventType: 'WORK_ASSIGNED' as const,
      payload: { count: 1 },
      prevEventHash: GENESIS_HASH,
    };

    const hash1 = computeEventHash(event);
    const hash2 = computeEventHash(event);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('should produce different hashes for different payloads', () => {
    const base = {
      eventId: 'evt-1',
      dayId,
      sequenceNumber: 0,
      timestamp: '2026-01-28T12:00:00.000Z',
      eventType: 'WORK_ASSIGNED' as const,
      prevEventHash: GENESIS_HASH,
    };

    const hash1 = computeEventHash({ ...base, payload: { count: 1 } });
    const hash2 = computeEventHash({ ...base, payload: { count: 2 } });
    expect(hash1).not.toBe(hash2);
  });

  it('should exclude timestamp from hash computation', () => {
    const event1 = {
      eventId: 'evt-1',
      dayId,
      sequenceNumber: 0,
      timestamp: '2026-01-28T12:00:00.000Z',
      eventType: 'WORK_ASSIGNED' as const,
      payload: { count: 1 },
      prevEventHash: GENESIS_HASH,
    };
    const event2 = { ...event1, timestamp: '2026-01-29T12:00:00.000Z' };

    expect(computeEventHash(event1)).toBe(computeEventHash(event2));
  });
});

describe('computeStateHash', () => {
  it('should produce deterministic hashes for same state', () => {
    const state = createEmptyNetworkState();
    expect(computeStateHash(state)).toBe(computeStateHash(state));
  });

  it('should produce different hashes for different states', () => {
    const s1 = createEmptyNetworkState();
    const s2 = { ...createEmptyNetworkState(), dayNumber: 1 };
    expect(computeStateHash(s1)).not.toBe(computeStateHash(s2));
  });
});

describe('computeRewardHash', () => {
  it('should sort rewards by accountId before hashing', () => {
    const r1 = [
      { accountId: 'bob', totalReward: 100 },
      { accountId: 'alice', totalReward: 200 },
    ];
    const r2 = [
      { accountId: 'alice', totalReward: 200 },
      { accountId: 'bob', totalReward: 100 },
    ];
    expect(computeRewardHash(r1)).toBe(computeRewardHash(r2));
  });
});

describe('buildDayEvents', () => {
  it('should build hash chain starting from prevEventHash', () => {
    const result = makeMinimalDayResult();
    const events = buildDayEvents(dayId, result, [], GENESIS_HASH, baseTime.toISOString());

    expect(events[0].prevEventHash).toBe(GENESIS_HASH);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].prevEventHash).toBe(events[i - 1].eventHash);
    }
  });

  it('should have monotonically increasing sequence numbers', () => {
    const result = makeMinimalDayResult();
    const events = buildDayEvents(dayId, result, [], GENESIS_HASH, baseTime.toISOString());

    for (let i = 0; i < events.length; i++) {
      expect(events[i].sequenceNumber).toBe(i);
    }
  });

  it('should include WORK_ASSIGNED event with assignments', () => {
    const result = makeMinimalDayResult();
    const events = buildDayEvents(dayId, result, [], GENESIS_HASH, baseTime.toISOString());

    const workAssigned = events.find(e => e.eventType === 'WORK_ASSIGNED');
    expect(workAssigned).toBeDefined();
    expect((workAssigned!.payload as { totalBlocks: number }).totalBlocks).toBe(2);
  });

  it('should include CANARIES_SELECTED with sorted IDs', () => {
    const result = makeMinimalDayResult();
    result.canaryBlockIds = ['c2', 'c1'];
    const events = buildDayEvents(dayId, result, [], GENESIS_HASH, baseTime.toISOString());

    const canaries = events.find(e => e.eventType === 'CANARIES_SELECTED');
    expect(canaries).toBeDefined();
    expect((canaries!.payload as { canaryBlockIds: string[] }).canaryBlockIds).toEqual(['c1', 'c2']);
  });

  it('should include DAY_FINALIZED with sorted rewards', () => {
    const result = makeMinimalDayResult();
    result.rewardDistribution.rewards = [
      {
        accountId: 'bob',
        basePoolReward: 400,
        performancePoolReward: 100,
        luckPoolReward: 0,
        totalReward: 500,
      },
      {
        accountId: 'alice',
        basePoolReward: 400,
        performancePoolReward: 100,
        luckPoolReward: 0,
        totalReward: 500,
      },
    ];

    const events = buildDayEvents(dayId, result, [], GENESIS_HASH, baseTime.toISOString());
    const finalized = events.find(e => e.eventType === 'DAY_FINALIZED');
    expect(finalized).toBeDefined();
    const rewards = (finalized!.payload as { rewards: { accountId: string }[] }).rewards;
    expect(rewards[0].accountId).toBe('alice');
    expect(rewards[1].accountId).toBe('bob');
  });

  it('should end with REWARDS_COMMITTED containing hashes', () => {
    const result = makeMinimalDayResult();
    const events = buildDayEvents(dayId, result, [], GENESIS_HASH, baseTime.toISOString());

    const committed = events[events.length - 1];
    expect(committed.eventType).toBe('REWARDS_COMMITTED');
    expect((committed.payload as { rewardHash: string }).rewardHash).toHaveLength(64);
    expect((committed.payload as { verificationValid: boolean }).verificationValid).toBe(true);
  });

  it('should build SUBMISSION_RECEIVED and SUBMISSION_PROCESSED for submissions', () => {
    const result = makeMinimalDayResult();
    result.submissionResults = [
      {
        contributorId: 'alice',
        blockId: 'b1',
        canaryDetected: false,
        penaltyApplied: false,
      },
    ];
    result.updatedContributors = new Map([
      [
        'alice',
        {
          accountId: 'alice',
          completedBlocks: [],
          reputationMultiplier: 1.0,
          canaryFailures: 0,
          canaryPasses: 0,
        },
      ],
    ]);

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

    const events = buildDayEvents(dayId, result, submissions, GENESIS_HASH, baseTime.toISOString());

    const received = events.find(e => e.eventType === 'SUBMISSION_RECEIVED');
    const processed = events.find(e => e.eventType === 'SUBMISSION_PROCESSED');

    expect(received).toBeDefined();
    expect((received!.payload as { blockId: string }).blockId).toBe('b1');
    expect(received!.actorId).toBe('alice');

    expect(processed).toBeDefined();
    expect((processed!.payload as { accepted: boolean }).accepted).toBe(true);
  });
});

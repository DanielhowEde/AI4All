/**
 * Unit tests for Base Participation Pool Distribution
 */

import {
  getActiveContributors,
  calculateBasePoolAmount,
  calculatePerformancePoolAmount,
  distributeBasePool,
  calculateBasePoolRewards,
  calculatePerformanceWeight,
  distributePerformancePool,
  calculateDailyRewards,
  calculateRewardDistribution,
} from './rewardDistribution';
import {
  Contributor,
  RewardConfig,
  DEFAULT_REWARD_CONFIG,
  BlockType,
} from './types';

describe('Milestone 2: Base Participation Pool', () => {
  const config: RewardConfig = {
    ...DEFAULT_REWARD_CONFIG,
    dailyEmissions: 22_800,
    basePoolPercentage: 0.30,
    performancePoolPercentage: 0.70,
    minBlocksForActive: 1,
    minReliability: 0.5,
  };

  describe('calculateBasePoolAmount', () => {
    it('should calculate 30% of daily emissions for base pool', () => {
      const basePool = calculateBasePoolAmount(config);
      expect(basePool).toBe(6_840); // 22,800 × 0.30
    });

    it('should handle different base pool percentages', () => {
      const customConfig: RewardConfig = {
        ...config,
        dailyEmissions: 10_000,
        basePoolPercentage: 0.40,
      };

      const basePool = calculateBasePoolAmount(customConfig);
      expect(basePool).toBe(4_000); // 10,000 × 0.40
    });

    it('should return 0 if base pool percentage is 0', () => {
      const customConfig: RewardConfig = {
        ...config,
        basePoolPercentage: 0,
      };

      const basePool = calculateBasePoolAmount(customConfig);
      expect(basePool).toBe(0);
    });
  });

  describe('calculatePerformancePoolAmount', () => {
    it('should calculate 70% of daily emissions for performance pool', () => {
      const performancePool = calculatePerformancePoolAmount(config);
      expect(performancePool).toBeCloseTo(15_960, 0); // 22,800 × 0.70
    });

    it('should handle different performance pool percentages', () => {
      const customConfig: RewardConfig = {
        ...config,
        dailyEmissions: 10_000,
        performancePoolPercentage: 0.60,
      };

      const performancePool = calculatePerformancePoolAmount(customConfig);
      expect(performancePool).toBe(6_000); // 10,000 × 0.60
    });
  });

  describe('getActiveContributors', () => {
    it('should return only active contributors', () => {
      const contributors: Contributor[] = [
        {
          accountId: 'alice',
          reputationMultiplier: 1.0,
          canaryFailures: 0,
          canaryPasses: 0,
          completedBlocks: [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: new Date('2026-01-27'),
            },
          ],
        },
        {
          accountId: 'bob',
          reputationMultiplier: 0.3, // Below minReliability (0.5)
          canaryFailures: 5,
          canaryPasses: 0,
          completedBlocks: [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: new Date('2026-01-27'),
            },
          ],
        },
        {
          accountId: 'charlie',
          reputationMultiplier: 1.0,
          canaryFailures: 0,
          canaryPasses: 0,
          completedBlocks: [], // No blocks completed
        },
      ];

      const active = getActiveContributors(contributors, config);

      // Only Alice should be active
      expect(active.length).toBe(1);
      expect(active[0].accountId).toBe('alice');
    });

    it('should return empty array if no contributors are active', () => {
      const contributors: Contributor[] = [
        {
          accountId: 'bob',
          reputationMultiplier: 0.0, // Zero reputation
          canaryFailures: 10,
          canaryPasses: 0,
          completedBlocks: [],
        },
      ];

      const active = getActiveContributors(contributors, config);
      expect(active.length).toBe(0);
    });

    it('should handle empty contributors array', () => {
      const active = getActiveContributors([], config);
      expect(active.length).toBe(0);
    });
  });

  describe('distributeBasePool', () => {
    it('should distribute equally among active contributors', () => {
      const activeContributors: Contributor[] = [
        {
          accountId: 'alice',
          reputationMultiplier: 1.0,
          canaryFailures: 0,
          canaryPasses: 0,
          completedBlocks: [],
        },
        {
          accountId: 'bob',
          reputationMultiplier: 1.0,
          canaryFailures: 0,
          canaryPasses: 0,
          completedBlocks: [],
        },
        {
          accountId: 'charlie',
          reputationMultiplier: 1.0,
          canaryFailures: 0,
          canaryPasses: 0,
          completedBlocks: [],
        },
      ];

      const basePoolAmount = 6_840; // From config
      const rewards = distributeBasePool(activeContributors, basePoolAmount);

      // Each should get 6,840 / 3 = 2,280
      expect(rewards.get('alice')).toBe(2_280);
      expect(rewards.get('bob')).toBe(2_280);
      expect(rewards.get('charlie')).toBe(2_280);
    });

    it('should handle single active contributor', () => {
      const activeContributors: Contributor[] = [
        {
          accountId: 'alice',
          reputationMultiplier: 1.0,
          canaryFailures: 0,
          canaryPasses: 0,
          completedBlocks: [],
        },
      ];

      const basePoolAmount = 6_840;
      const rewards = distributeBasePool(activeContributors, basePoolAmount);

      // Alice gets everything
      expect(rewards.get('alice')).toBe(6_840);
      expect(rewards.size).toBe(1);
    });

    it('should handle no active contributors (edge case)', () => {
      const rewards = distributeBasePool([], 6_840);

      // No rewards distributed
      expect(rewards.size).toBe(0);
    });

    it('should distribute fractional amounts correctly', () => {
      const activeContributors: Contributor[] = [
        { accountId: 'a1', reputationMultiplier: 1.0, canaryFailures: 0, canaryPasses: 0, completedBlocks: [] },
        { accountId: 'a2', reputationMultiplier: 1.0, canaryFailures: 0, canaryPasses: 0, completedBlocks: [] },
        { accountId: 'a3', reputationMultiplier: 1.0, canaryFailures: 0, canaryPasses: 0, completedBlocks: [] },
      ];

      // 10,000 / 3 = 3,333.333...
      const rewards = distributeBasePool(activeContributors, 10_000);

      expect(rewards.get('a1')).toBeCloseTo(3333.3333, 4);
      expect(rewards.get('a2')).toBeCloseTo(3333.3333, 4);
      expect(rewards.get('a3')).toBeCloseTo(3333.3333, 4);

      // Sum should equal total (within floating point error)
      const total = Array.from(rewards.values()).reduce((sum, val) => sum + val, 0);
      expect(total).toBeCloseTo(10_000, 2);
    });

    it('should handle large number of contributors', () => {
      const activeContributors: Contributor[] = Array.from({ length: 1000 }, (_, i) => ({
        accountId: `contributor_${i}`,
        reputationMultiplier: 1.0,
        canaryFailures: 0,
        canaryPasses: 0,
        completedBlocks: [],
      }));

      const basePoolAmount = 6_840;
      const rewards = distributeBasePool(activeContributors, basePoolAmount);

      // Each gets 6.84 tokens
      const expectedReward = 6.84;
      rewards.forEach(reward => {
        expect(reward).toBeCloseTo(expectedReward, 2);
      });

      expect(rewards.size).toBe(1000);
    });
  });

  describe('calculateBasePoolRewards', () => {
    it('should create ContributorReward objects for active contributors', () => {
      const contributors: Contributor[] = [
        {
          accountId: 'alice',
          reputationMultiplier: 1.0,
          canaryFailures: 0,
          canaryPasses: 0,
          completedBlocks: [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: new Date('2026-01-27'),
            },
          ],
        },
        {
          accountId: 'bob',
          reputationMultiplier: 1.0,
          canaryFailures: 0,
          canaryPasses: 0,
          completedBlocks: [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: new Date('2026-01-27'),
            },
          ],
        },
      ];

      const rewards = calculateBasePoolRewards(contributors, config);

      expect(rewards.length).toBe(2);

      // Each gets 3,420 tokens (6,840 / 2)
      expect(rewards[0].accountId).toBe('alice');
      expect(rewards[0].basePoolReward).toBe(3_420);
      expect(rewards[0].performancePoolReward).toBe(0); // Not calculated yet
      expect(rewards[0].luckPoolReward).toBe(0);
      expect(rewards[0].totalReward).toBe(3_420);
      expect(rewards[0].reason).toContain('Base pool');
      expect(rewards[0].reason).toContain('3420.000000000 tokens');

      expect(rewards[1].accountId).toBe('bob');
      expect(rewards[1].basePoolReward).toBe(3_420);
      expect(rewards[1].totalReward).toBe(3_420);
    });

    it('should return empty array if no active contributors', () => {
      const contributors: Contributor[] = [
        {
          accountId: 'blocked',
          reputationMultiplier: 0.0,
          canaryFailures: 10,
          canaryPasses: 0,
          completedBlocks: [],
        },
      ];

      const rewards = calculateBasePoolRewards(contributors, config);
      expect(rewards.length).toBe(0);
    });

    it('should handle single active contributor getting full base pool', () => {
      const contributors: Contributor[] = [
        {
          accountId: 'only_one',
          reputationMultiplier: 1.0,
          canaryFailures: 0,
          canaryPasses: 0,
          completedBlocks: [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: new Date('2026-01-27'),
            },
          ],
        },
      ];

      const rewards = calculateBasePoolRewards(contributors, config);

      expect(rewards.length).toBe(1);
      expect(rewards[0].basePoolReward).toBe(6_840); // Gets all 6,840 tokens
      expect(rewards[0].totalReward).toBe(6_840);
    });

    it('should not include blocked contributors in distribution', () => {
      const failureTime = new Date('2026-01-27T10:00:00Z');
      const currentTime = new Date('2026-01-27T12:00:00Z'); // 2 hours later

      const contributors: Contributor[] = [
        {
          accountId: 'alice',
          reputationMultiplier: 1.0,
          canaryFailures: 0,
          canaryPasses: 0,
          completedBlocks: [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: new Date('2026-01-27'),
            },
          ],
        },
        {
          accountId: 'bob_blocked',
          reputationMultiplier: 1.0,
          canaryFailures: 1,
          canaryPasses: 0,
          lastCanaryFailureTime: failureTime, // Blocked for 24h
          completedBlocks: [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: new Date('2026-01-27'),
            },
          ],
        },
      ];

      const rewards = calculateBasePoolRewards(contributors, config, currentTime);

      // Only Alice gets rewards (Bob is blocked)
      expect(rewards.length).toBe(1);
      expect(rewards[0].accountId).toBe('alice');
      expect(rewards[0].basePoolReward).toBe(6_840); // Gets full pool
    });
  });

  describe('Integration: Base Pool with Canary System', () => {
    it('should demonstrate fairness floor: small vs large contributors get equal base reward', () => {
      const contributors: Contributor[] = [
        {
          accountId: 'small_laptop',
          reputationMultiplier: 1.0,
          canaryFailures: 0,
          canaryPasses: 0,
          completedBlocks: [
            // Only 1 block completed
            {
              blockType: BlockType.VALIDATION,
              resourceUsage: 0.2,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: new Date('2026-01-27'),
            },
          ],
        },
        {
          accountId: 'large_gpu_farm',
          reputationMultiplier: 1.0,
          canaryFailures: 0,
          canaryPasses: 0,
          completedBlocks: [
            // 100 blocks completed (much more work)
            ...Array(100).fill({
              blockType: BlockType.TRAINING,
              resourceUsage: 1.0,
              difficultyMultiplier: 2.0,
              validationPassed: true,
              timestamp: new Date('2026-01-27'),
            }),
          ],
        },
      ];

      const rewards = calculateBasePoolRewards(contributors, config);

      expect(rewards.length).toBe(2);

      // Both get EQUAL base pool rewards (fairness floor)
      expect(rewards[0].basePoolReward).toBe(3_420); // 6,840 / 2
      expect(rewards[1].basePoolReward).toBe(3_420); // Same!

      // Note: Performance pool (Milestone 3) will reward the GPU farm more
    });

    it('should exclude cheaters with failed canaries from base pool', () => {
      const contributors: Contributor[] = [
        {
          accountId: 'honest_alice',
          reputationMultiplier: 1.0,
          canaryFailures: 0,
          canaryPasses: 5,
          completedBlocks: [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: new Date('2026-01-27'),
            },
          ],
        },
        {
          accountId: 'cheater_bob',
          reputationMultiplier: 1.0, // Base 1.0
          canaryFailures: 10, // Many failures
          canaryPasses: 0,
          completedBlocks: [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: new Date('2026-01-27'),
            },
            // Add actual failed canary blocks
            ...Array.from({ length: 10 }, () => ({
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: new Date('2026-01-27'),
              isCanary: true,
              canaryAnswerCorrect: false,
            })),
          ],
        },
      ];

      // Bob's effective reputation: 1.0 - (10 × 0.1) = 0.0
      // 0.0 < 0.5 minReliability, so Bob is rejected

      const rewards = calculateBasePoolRewards(contributors, config);

      expect(rewards.length).toBe(1);
      expect(rewards[0].accountId).toBe('honest_alice');
      expect(rewards[0].basePoolReward).toBe(6_840); // Gets full base pool
    });

    it('should allow rehabilitated contributors back into base pool', () => {
      const contributors: Contributor[] = [
        {
          accountId: 'alice',
          reputationMultiplier: 1.0,
          canaryFailures: 0,
          canaryPasses: 0,
          completedBlocks: [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: new Date('2026-01-27'),
            },
          ],
        },
        {
          accountId: 'reformed_bob',
          reputationMultiplier: 1.0,
          canaryFailures: 3, // Had 3 failures
          canaryPasses: 10, // But passed 10 canaries (rehabilitated!)
          completedBlocks: [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: new Date('2026-01-27'),
            },
          ],
        },
      ];

      // Bob's effective reputation: 1.0 - (3 × 0.1) = 0.7
      // 0.7 > 0.5 minReliability, so Bob is accepted!

      const rewards = calculateBasePoolRewards(contributors, config);

      expect(rewards.length).toBe(2);
      expect(rewards.find(r => r.accountId === 'reformed_bob')).toBeDefined();
      expect(rewards[0].basePoolReward).toBe(3_420); // Split 6,840 / 2
      expect(rewards[1].basePoolReward).toBe(3_420);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very small base pool amounts', () => {
      const customConfig: RewardConfig = {
        ...config,
        dailyEmissions: 10, // Only 10 tokens
        basePoolPercentage: 0.30,
      };

      const contributors: Contributor[] = [
        {
          accountId: 'alice',
          reputationMultiplier: 1.0,
          canaryFailures: 0,
          canaryPasses: 0,
          completedBlocks: [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: new Date('2026-01-27'),
            },
          ],
        },
        {
          accountId: 'bob',
          reputationMultiplier: 1.0,
          canaryFailures: 0,
          canaryPasses: 0,
          completedBlocks: [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: new Date('2026-01-27'),
            },
          ],
        },
      ];

      const rewards = calculateBasePoolRewards(contributors, customConfig);

      // Base pool = 10 × 0.30 = 3 tokens
      // Each gets 1.5 tokens
      expect(rewards[0].basePoolReward).toBe(1.5);
      expect(rewards[1].basePoolReward).toBe(1.5);
    });

    it('should handle zero base pool percentage', () => {
      const customConfig: RewardConfig = {
        ...config,
        basePoolPercentage: 0, // No base pool
      };

      const contributors: Contributor[] = [
        {
          accountId: 'alice',
          reputationMultiplier: 1.0,
          canaryFailures: 0,
          canaryPasses: 0,
          completedBlocks: [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: new Date('2026-01-27'),
            },
          ],
        },
      ];

      const rewards = calculateBasePoolRewards(contributors, customConfig);

      expect(rewards.length).toBe(1);
      expect(rewards[0].basePoolReward).toBe(0); // No base pool
      expect(rewards[0].totalReward).toBe(0);
    });
  });
});

describe('Milestone 3: Performance Pool with sqrt Diminishing Returns', () => {
  const config: RewardConfig = {
    ...DEFAULT_REWARD_CONFIG,
    dailyEmissions: 22_000,
    basePoolPercentage: 0.20,
    performancePoolPercentage: 0.80,
    minBlocksForActive: 1,
    minReliability: 0.0,
  };

  // Fixed reference time matching the hardcoded block timestamps, so tests are date-independent
  const TEST_NOW = new Date('2026-01-27T12:00:00Z');

  // Helper: Create contributor with specific points
  const createContributor = (
    accountId: string,
    points: number,
    reputation: number = 1.0
  ): Contributor => {
    // Each INFERENCE block = 10 points (base 10, resource 1.0, difficulty 1.0, validation 1.0)
    const numBlocks = Math.ceil(points / 10);
    const blocks = Array.from({ length: numBlocks }, () => ({
      blockType: BlockType.INFERENCE,
      resourceUsage: 1.0,
      difficultyMultiplier: 1.0,
      validationPassed: true,
      timestamp: new Date('2026-01-27'),
      isCanary: false,
    }));

    return {
      accountId,
      reputationMultiplier: reputation,
      canaryFailures: 0,
      canaryPasses: 0,
      completedBlocks: blocks,
    };
  };

  describe('calculatePerformanceWeight', () => {
    it('should calculate sqrt of total compute points', () => {
      const contributor = createContributor('alice', 100);
      const weight = calculatePerformanceWeight(contributor, config, TEST_NOW);
      expect(weight).toBeCloseTo(10, 2); // sqrt(100) = 10
    });

    it('should demonstrate diminishing returns', () => {
      const alice100 = createContributor('alice', 100);
      const bob400 = createContributor('bob', 400);
      const charlie900 = createContributor('charlie', 900);

      const weightAlice = calculatePerformanceWeight(alice100, config, TEST_NOW);
      const weightBob = calculatePerformanceWeight(bob400, config, TEST_NOW);
      const weightCharlie = calculatePerformanceWeight(charlie900, config, TEST_NOW);

      expect(weightAlice).toBeCloseTo(10, 2); // sqrt(100) = 10
      expect(weightBob).toBeCloseTo(20, 2); // sqrt(400) = 20 (4x points = 2x weight)
      expect(weightCharlie).toBeCloseTo(30, 2); // sqrt(900) = 30 (9x points = 3x weight)

      // Diminishing returns demonstrated
      expect(weightBob / weightAlice).toBeCloseTo(2, 1); // 4x points → 2x weight
      expect(weightCharlie / weightAlice).toBeCloseTo(3, 1); // 9x points → 3x weight
    });

    it('should return 0 for contributors with no blocks', () => {
      const newbie = createContributor('newbie', 0);
      const weight = calculatePerformanceWeight(newbie, config);
      expect(weight).toBe(0);
    });

    it('should handle fractional points', () => {
      const contributor = createContributor('alice', 50);
      const weight = calculatePerformanceWeight(contributor, config, TEST_NOW);
      expect(weight).toBeCloseTo(Math.sqrt(50), 2);
    });
  });

  describe('distributePerformancePool', () => {
    it('should distribute based on sqrt weights proportionally', () => {
      const contributors = [
        createContributor('alice', 900), // sqrt(900) = 30
        createContributor('bob', 400),   // sqrt(400) = 20
        createContributor('charlie', 100), // sqrt(100) = 10
      ];

      const performancePoolAmount = 17_600; // 80% of 22,000
      const rewards = distributePerformancePool(contributors, performancePoolAmount, config, TEST_NOW);

      // Total weight = 30 + 20 + 10 = 60
      // Alice: 30/60 = 50% → 8,800 tokens
      // Bob: 20/60 = 33.33% → 5,866.67 tokens
      // Charlie: 10/60 = 16.67% → 2,933.33 tokens

      expect(rewards.get('alice')).toBeCloseTo(8_800, 0);
      expect(rewards.get('bob')).toBeCloseTo(5_866.67, 0);
      expect(rewards.get('charlie')).toBeCloseTo(2_933.33, 0);

      // Verify total distribution
      const total = Array.from(rewards.values()).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(performancePoolAmount, 0);
    });

    it('should give 100% to single contributor', () => {
      const contributors = [createContributor('alice', 100)];
      const performancePoolAmount = 17_600;
      const rewards = distributePerformancePool(contributors, performancePoolAmount, config);

      expect(rewards.get('alice')).toBe(17_600);
    });

    it('should distribute equally when all have same points', () => {
      const contributors = [
        createContributor('alice', 100),
        createContributor('bob', 100),
        createContributor('charlie', 100),
      ];

      const performancePoolAmount = 15_000;
      const rewards = distributePerformancePool(contributors, performancePoolAmount, config);

      // All have same weight (sqrt(100) = 10), so equal distribution
      expect(rewards.get('alice')).toBeCloseTo(5_000, 0);
      expect(rewards.get('bob')).toBeCloseTo(5_000, 0);
      expect(rewards.get('charlie')).toBeCloseTo(5_000, 0);
    });

    it('should return empty map for no contributors', () => {
      const rewards = distributePerformancePool([], 17_600, config);
      expect(rewards.size).toBe(0);
    });

    it('should distribute equally when all contributors have 0 points', () => {
      const contributors = [
        createContributor('alice', 0),
        createContributor('bob', 0),
      ];

      const performancePoolAmount = 10_000;
      const rewards = distributePerformancePool(contributors, performancePoolAmount, config);

      // Total weight = 0, so fall back to equal distribution
      expect(rewards.get('alice')).toBe(5_000);
      expect(rewards.get('bob')).toBe(5_000);
    });

    it('should handle large numbers without precision loss', () => {
      const contributors = [
        createContributor('alice', 1_000_000), // sqrt = 1000
        createContributor('bob', 250_000),     // sqrt = 500
      ];

      const performancePoolAmount = 1_000_000;
      const rewards = distributePerformancePool(contributors, performancePoolAmount, config, TEST_NOW);

      // Total weight = 1500
      // Alice: 1000/1500 = 66.67%
      // Bob: 500/1500 = 33.33%

      expect(rewards.get('alice')).toBeCloseTo(666_666.67, 0);
      expect(rewards.get('bob')).toBeCloseTo(333_333.33, 0);
    });

    it('should distribute same total when splitting (no other competitors)', () => {
      // Scenario: Single account vs split accounts with same total points
      // WITHOUT other competitors in the pool

      const singleAccount = [createContributor('alice', 400)];
      const splitAccounts = [
        createContributor('bob1', 100),
        createContributor('bob2', 100),
        createContributor('bob3', 100),
        createContributor('bob4', 100),
      ];

      const poolAmount = 10_000;

      // Single account
      const singleRewards = distributePerformancePool(singleAccount, poolAmount, config);
      const aliceReward = singleRewards.get('alice') || 0;

      // Split accounts
      const splitRewards = distributePerformancePool(splitAccounts, poolAmount, config);
      const bobTotalReward =
        (splitRewards.get('bob1') || 0) +
        (splitRewards.get('bob2') || 0) +
        (splitRewards.get('bob3') || 0) +
        (splitRewards.get('bob4') || 0);

      // Alice gets 100% with single account
      expect(aliceReward).toBe(10_000);

      // Split accounts get 100% total (same as single)
      expect(bobTotalReward).toBeCloseTo(10_000, 0);

      // NOTE: This does NOT prove Sybil resistance! When competing with others,
      // splitting actually INCREASES total weight because sqrt is concave:
      // sqrt(100)+sqrt(100)+sqrt(100)+sqrt(100) = 40 > sqrt(400) = 20
      // Actual Sybil defense comes from per-account canary validation + operational friction
    });
  });

  describe('calculateDailyRewards', () => {
    it('should combine base pool and performance pool', () => {
      const contributors = [
        createContributor('alice', 900),
        createContributor('bob', 100),
      ];

      const rewards = calculateDailyRewards(contributors, config, TEST_NOW);

      // Base pool: 22,000 × 0.20 = 4,400 / 2 = 2,200 each
      // Performance pool: 22,000 × 0.80 = 17,600
      //   Total weight = sqrt(900) + sqrt(100) = 30 + 10 = 40
      //   Alice: 30/40 × 17,600 = 13,200
      //   Bob: 10/40 × 17,600 = 4,400

      expect(rewards[0].accountId).toBe('alice');
      expect(rewards[0].basePoolReward).toBeCloseTo(2_200, 0);
      expect(rewards[0].performancePoolReward).toBeCloseTo(13_200, 0);
      expect(rewards[0].totalReward).toBeCloseTo(15_400, 0);

      expect(rewards[1].accountId).toBe('bob');
      expect(rewards[1].basePoolReward).toBeCloseTo(2_200, 0);
      expect(rewards[1].performancePoolReward).toBeCloseTo(4_400, 0);
      expect(rewards[1].totalReward).toBeCloseTo(6_600, 0);

      // Total distributed = 15,400 + 6,600 = 22,000
      const totalDistributed = rewards.reduce((sum, r) => sum + r.totalReward, 0);
      expect(totalDistributed).toBeCloseTo(22_000, 0);
    });

    it('should show diminishing returns benefit small contributors', () => {
      const contributors = [
        createContributor('high_performer', 10_000),
        createContributor('low_performer', 100),
      ];

      const rewards = calculateDailyRewards(contributors, config, TEST_NOW);

      const highPerformer = rewards.find(r => r.accountId === 'high_performer')!;
      const lowPerformer = rewards.find(r => r.accountId === 'low_performer')!;

      // High performer has 100x points but doesn't get 100x reward
      const rewardRatio = highPerformer.totalReward / lowPerformer.totalReward;
      const pointsRatio = 10_000 / 100; // = 100

      expect(rewardRatio).toBeLessThan(pointsRatio); // Diminishing returns working
      expect(rewardRatio).toBeGreaterThan(1); // But still gets more
      // Base pool: 4,400 / 2 = 2,200 each
      // Perf pool: high gets (100/110) × 17,600 = 16,000, low gets (10/110) × 17,600 = 1,600
      // Total: high = 18,200, low = 3,800, ratio = 4.79
      expect(rewardRatio).toBeCloseTo(4.79, 1);
    });

    it('should handle single contributor getting everything', () => {
      const contributors = [createContributor('alice', 500)];
      const rewards = calculateDailyRewards(contributors, config);

      expect(rewards.length).toBe(1);
      expect(rewards[0].totalReward).toBeCloseTo(22_000, 0); // Gets all emissions
    });

    it('should exclude inactive contributors', () => {
      const contributors = [
        createContributor('alice', 100, 1.0),
        createContributor('bob', 100, 0.0), // Zero reputation (inactive)
      ];

      const customConfig = { ...config, minReliability: 0.1 };
      const rewards = calculateDailyRewards(contributors, customConfig);

      // Only alice should be active
      expect(rewards.length).toBe(1);
      expect(rewards[0].accountId).toBe('alice');
      expect(rewards[0].totalReward).toBeCloseTo(22_000, 0); // Gets everything
    });

    it('should handle 24h blocked contributors', () => {
      const now = new Date('2026-01-27T12:00:00Z');
      const contributors = [
        createContributor('alice', 100),
        {
          ...createContributor('bob', 100),
          lastCanaryFailureTime: new Date('2026-01-27T06:00:00Z'), // 6 hours ago (blocked)
        },
      ];

      const rewards = calculateDailyRewards(contributors, config, now);

      // Only alice should receive rewards (bob is blocked)
      expect(rewards.length).toBe(1);
      expect(rewards[0].accountId).toBe('alice');
    });

    it('should create proper reason strings', () => {
      const contributors = [createContributor('alice', 100)];
      const rewards = calculateDailyRewards(contributors, config);

      expect(rewards[0].reason).toContain('Base:');
      expect(rewards[0].reason).toContain('Performance:');
      expect(rewards[0].reason).toContain('points');
      expect(rewards[0].reason).toContain('weight');
    });
  });

  describe('calculateRewardDistribution', () => {
    it('should return complete distribution with metadata', () => {
      const contributors = [
        createContributor('alice', 400),
        createContributor('bob', 100),
      ];

      const now = new Date('2026-01-27T00:00:00Z');
      const distribution = calculateRewardDistribution(contributors, config, now);

      expect(distribution.date).toEqual(now);
      expect(distribution.config).toEqual(config);
      expect(distribution.totalEmissions).toBe(22_000);
      expect(distribution.basePoolTotal).toBeCloseTo(4_400, 0);
      expect(distribution.performancePoolTotal).toBeCloseTo(17_600, 0);
      expect(distribution.luckPoolTotal).toBe(0);
      expect(distribution.activeContributorCount).toBe(2);
      expect(distribution.rewards.length).toBe(2);
    });

    it('should have rewards that sum to total emissions', () => {
      const contributors = [
        createContributor('alice', 900),
        createContributor('bob', 400),
        createContributor('charlie', 100),
      ];

      const distribution = calculateRewardDistribution(contributors, config);

      const totalDistributed = distribution.rewards.reduce(
        (sum, r) => sum + r.totalReward,
        0
      );

      expect(totalDistributed).toBeCloseTo(distribution.totalEmissions, 0);
    });
  });

  describe('Integration: Performance Pool + Reputation System', () => {
    it('should not directly penalize performance pool by reputation', () => {
      // Note: Reputation affects whether you're active (via isActiveContributor)
      // But once active, performance pool is based solely on points, not reputation
      // Reputation affects block assignment (upstream), not reward distribution (downstream)

      const contributors = [
        createContributor('alice', 100, 1.0),  // Perfect reputation
        createContributor('bob', 100, 0.5),    // Poor reputation
      ];

      const rewards = calculateDailyRewards(contributors, config);

      // Both have same points, so same performance pool share
      const alice = rewards.find(r => r.accountId === 'alice')!;
      const bob = rewards.find(r => r.accountId === 'bob')!;

      expect(alice.performancePoolReward).toBeCloseTo(bob.performancePoolReward, 0);
      expect(alice.totalReward).toBeCloseTo(bob.totalReward, 0);
    });

    it('should exclude contributors blocked by canary failures', () => {
      const now = new Date('2026-01-27T12:00:00Z');

      const contributors = [
        createContributor('alice', 100),
        {
          ...createContributor('bob', 100),
          lastCanaryFailureTime: new Date('2026-01-27T06:00:00Z'), // Blocked (6h ago)
          canaryFailures: 1,
        },
        {
          ...createContributor('charlie', 100),
          lastCanaryFailureTime: new Date('2026-01-26T06:00:00Z'), // Not blocked (30h ago)
          canaryFailures: 1,
        },
      ];

      const rewards = calculateDailyRewards(contributors, config, now);

      // Bob should be excluded (24h block active)
      // Alice and Charlie should share the rewards
      expect(rewards.length).toBe(2);
      expect(rewards.find(r => r.accountId === 'alice')).toBeDefined();
      expect(rewards.find(r => r.accountId === 'bob')).toBeUndefined();
      expect(rewards.find(r => r.accountId === 'charlie')).toBeDefined();
    });
  });

  describe('Edge Cases and Robustness', () => {
    it('should handle very small performance pool', () => {
      const customConfig = {
        ...config,
        performancePoolPercentage: 0.01, // 1%
        basePoolPercentage: 0.99,
      };

      const contributors = [
        createContributor('alice', 900),
        createContributor('bob', 100),
      ];

      const rewards = calculateDailyRewards(contributors, customConfig);

      // Performance pool = 22,000 × 0.01 = 220 tokens
      const totalPerformance = rewards.reduce((sum, r) => sum + r.performancePoolReward, 0);
      expect(totalPerformance).toBeCloseTo(220, 0);
    });

    it('should handle zero performance pool', () => {
      const customConfig = {
        ...config,
        performancePoolPercentage: 0,
        basePoolPercentage: 1.0,
      };

      const contributors = [
        createContributor('alice', 100),
        createContributor('bob', 900),
      ];

      const rewards = calculateDailyRewards(contributors, customConfig);

      // All rewards from base pool (equal)
      expect(rewards[0].performancePoolReward).toBe(0);
      expect(rewards[1].performancePoolReward).toBe(0);
      expect(rewards[0].totalReward).toBeCloseTo(11_000, 0);
      expect(rewards[1].totalReward).toBeCloseTo(11_000, 0);
    });

    it('should handle fractional token amounts correctly', () => {
      const contributors = [
        createContributor('alice', 100),
        createContributor('bob', 100),
        createContributor('charlie', 100),
      ];

      const customConfig = { ...config, dailyEmissions: 10 };
      const rewards = calculateDailyRewards(contributors, customConfig);

      // Total should still equal emissions despite rounding
      const total = rewards.reduce((sum, r) => sum + r.totalReward, 0);
      expect(total).toBeCloseTo(10, 2);
    });

    it('should handle 100 contributors efficiently', () => {
      const contributors = Array.from({ length: 100 }, (_, i) =>
        createContributor(`contributor_${i}`, (i + 1) * 10)
      );

      const startTime = Date.now();
      const rewards = calculateDailyRewards(contributors, config);
      const duration = Date.now() - startTime;

      expect(rewards.length).toBe(100);
      expect(duration).toBeLessThan(1000); // Should complete in < 1 second

      // Verify total distribution
      const total = rewards.reduce((sum, r) => sum + r.totalReward, 0);
      expect(total).toBeCloseTo(22_000, 0);
    });

    it('should exclude canary blocks from reward calculations', () => {
      const currentTime = new Date('2026-01-28T00:00:00Z'); // Next day, so 24h block expired

      const contributors = [
        {
          accountId: 'alice',
          reputationMultiplier: 1.0,
          canaryFailures: 0,
          canaryPasses: 2,
          completedBlocks: [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: new Date('2026-01-27'),
              isCanary: false, // Real work
            },
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: new Date('2026-01-27'),
              isCanary: true, // Passed canary - should be excluded
              canaryAnswerCorrect: true,
            },
            {
              blockType: BlockType.TRAINING,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: new Date('2026-01-27'),
              isCanary: false, // Real work
            },
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: new Date('2026-01-27'),
              isCanary: true, // Passed canary - should be excluded
              canaryAnswerCorrect: true,
            },
          ],
        },
        {
          accountId: 'bob',
          reputationMultiplier: 1.0,
          canaryFailures: 1,
          canaryPasses: 0,
          completedBlocks: [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: new Date('2026-01-27'),
              isCanary: false, // Real work
            },
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: new Date('2026-01-27'),
              isCanary: true, // Failed canary - should be excluded
              canaryAnswerCorrect: false,
            },
          ],
        },
      ];

      const rewards = calculateDailyRewards(contributors, config, currentTime);

      // Alice: Real work = INFERENCE (10) + TRAINING (15) = 25 points
      //        Canaries excluded (2 blocks)
      // Bob: Real work = INFERENCE (10) points
      //      Failed canary excluded (1 block)

      // Base pool: 4,400 / 2 = 2,200 each
      // Performance pool: 17,600
      //   Alice weight: sqrt(25) = 5
      //   Bob weight: sqrt(10) ≈ 3.162
      //   Total weight: 8.162
      //   Alice: (5 / 8.162) × 17,600 ≈ 10,781
      //   Bob: (3.162 / 8.162) × 17,600 ≈ 6,819

      const alice = rewards.find(r => r.accountId === 'alice')!;
      const bob = rewards.find(r => r.accountId === 'bob')!;

      expect(alice.basePoolReward).toBeCloseTo(2_200, 0);
      expect(alice.performancePoolReward).toBeCloseTo(10_781, 0);
      expect(alice.totalReward).toBeCloseTo(12_981, 0);

      expect(bob.basePoolReward).toBeCloseTo(2_200, 0);
      expect(bob.performancePoolReward).toBeCloseTo(6_819, 0);
      expect(bob.totalReward).toBeCloseTo(9_019, 0);

      // Verify that reason mentions correct point count (excluding canaries)
      expect(alice.reason).toContain('25 points'); // Not 35
      expect(bob.reason).toContain('10 points'); // Not 20
    });

    it('should give 0 reward if contributor only completed canaries', () => {
      const contributors = [
        createContributor('alice', 100), // Real work
        {
          accountId: 'bob',
          reputationMultiplier: 1.0,
          canaryFailures: 0,
          canaryPasses: 5,
          completedBlocks: Array.from({ length: 5 }, () => ({
            blockType: BlockType.INFERENCE,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            validationPassed: true,
            timestamp: new Date('2026-01-27'),
            isCanary: true, // All canaries
            canaryAnswerCorrect: true,
          })),
        },
      ];

      const rewards = calculateDailyRewards(contributors, config, TEST_NOW);

      // Bob has 0 reward points (all canaries), so 0 performance weight
      // But still gets base pool share

      const alice = rewards.find(r => r.accountId === 'alice')!;
      const bob = rewards.find(r => r.accountId === 'bob')!;

      // Base pool: 4,400 / 2 = 2,200 each
      // Performance pool: Bob has 0 weight, Alice has 100% of performance pool
      expect(bob.basePoolReward).toBeCloseTo(2_200, 0);
      expect(bob.performancePoolReward).toBeCloseTo(0, 0); // No real work
      expect(bob.totalReward).toBeCloseTo(2_200, 0);

      expect(alice.performancePoolReward).toBeCloseTo(17_600, 0); // All of it
    });
  });
});

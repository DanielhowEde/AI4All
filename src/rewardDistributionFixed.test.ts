/**
 * Fixed-Point Reward Distribution Tests
 *
 * Tests for deterministic reward calculations using bigint microunits.
 */

import { BlockType, Contributor, DEFAULT_REWARD_CONFIG } from './types';
import {
  calculateBasePoolAmount,
  calculatePerformancePoolAmount,
  distributeBasePool,
  distributePerformancePool,
  calculateDailyRewards,
  calculateRewardDistribution,
  verifyExactDistribution,
} from './rewardDistributionFixed';
import { toMicroUnits, toTokens } from './fixedPoint';

describe('Fixed-Point Reward Distribution', () => {
  // Helper to create a contributor with specified points
  // Creates multiple blocks with resourceUsage=1.0 to achieve target points
  const createContributor = (
    accountId: string,
    points: number,
    reputation: number = 1.0
  ): Contributor => {
    const now = new Date();
    const blocks = [];

    // Create blocks to achieve target points
    // Each block: resourceUsage=1.0, difficultyMultiplier=1.0 → 1 point per block
    const numBlocks = Math.floor(points);

    // Only create blocks if points > 0
    if (numBlocks > 0) {
      for (let i = 0; i < numBlocks; i++) {
        blocks.push({
          blockType: BlockType.INFERENCE,
          resourceUsage: 1.0, // Valid: between 0 and 1
          difficultyMultiplier: 1.0,
          validationPassed: true,
          timestamp: new Date(now.getTime() - i * 1000), // Slightly different timestamps
          isCanary: false,
        });
      }
    }

    return {
      accountId,
      completedBlocks: blocks,
      reputationMultiplier: reputation,
      canaryFailures: 0,
      canaryPasses: 0,
    };
  };

  describe('calculateBasePoolAmount', () => {
    it('should calculate 20% of daily emissions', () => {
      const amount = calculateBasePoolAmount(DEFAULT_REWARD_CONFIG);
      const tokens = toTokens(amount);
      expect(tokens).toBe(4400); // 20% of 22,000
    });

    it('should return exact microunits', () => {
      const amount = calculateBasePoolAmount(DEFAULT_REWARD_CONFIG);
      expect(amount).toBe(4_400_000_000n); // 4,400 tokens in microunits
    });
  });

  describe('calculatePerformancePoolAmount', () => {
    it('should calculate 80% of daily emissions', () => {
      const amount = calculatePerformancePoolAmount(DEFAULT_REWARD_CONFIG);
      const tokens = toTokens(amount);
      expect(tokens).toBe(17600); // 80% of 22,000
    });

    it('should return exact microunits', () => {
      const amount = calculatePerformancePoolAmount(DEFAULT_REWARD_CONFIG);
      expect(amount).toBe(17_600_000_000n); // 17,600 tokens in microunits
    });
  });

  describe('distributeBasePool', () => {
    it('should distribute equally among contributors', () => {
      const contributors = [
        createContributor('alice', 100),
        createContributor('bob', 50),
        createContributor('charlie', 200),
      ];

      const poolAmount = toMicroUnits(4400);
      const rewards = distributeBasePool(contributors, poolAmount);

      // Each should get 4400 / 3 = 1466.666...
      const alice = toTokens(rewards.get('alice')!);
      const bob = toTokens(rewards.get('bob')!);
      const charlie = toTokens(rewards.get('charlie')!);

      expect(alice).toBeCloseTo(1466.67, 2);
      expect(bob).toBeCloseTo(1466.67, 2);
      expect(charlie).toBeCloseTo(1466.67, 2);

      // Exact sum
      const sum = rewards.get('alice')! + rewards.get('bob')! + rewards.get('charlie')!;
      expect(sum).toBe(poolAmount);
    });

    it('should handle single contributor', () => {
      const contributors = [createContributor('alice', 100)];
      const poolAmount = toMicroUnits(4400);
      const rewards = distributeBasePool(contributors, poolAmount);

      expect(rewards.get('alice')).toBe(poolAmount);
    });

    it('should handle empty list', () => {
      const rewards = distributeBasePool([], toMicroUnits(4400));
      expect(rewards.size).toBe(0);
    });
  });

  describe('distributePerformancePool', () => {
    it('should distribute using sqrt weights', () => {
      const contributors = [
        createContributor('alice', 100), // sqrt(100) = 10
        createContributor('bob', 400), // sqrt(400) = 20
        createContributor('charlie', 900), // sqrt(900) = 30
      ]; // Total weight = 60

      const poolAmount = toMicroUnits(6000);
      const currentTime = new Date();
      const rewards = distributePerformancePool(
        contributors,
        poolAmount,
        DEFAULT_REWARD_CONFIG,
        currentTime
      );

      // Expected: 1000, 2000, 3000
      expect(toTokens(rewards.get('alice')!)).toBeCloseTo(1000, 1);
      expect(toTokens(rewards.get('bob')!)).toBeCloseTo(2000, 1);
      expect(toTokens(rewards.get('charlie')!)).toBeCloseTo(3000, 1);

      // Exact sum
      const sum = rewards.get('alice')! + rewards.get('bob')! + rewards.get('charlie')!;
      expect(sum).toBe(poolAmount);
    });

    it('should handle zero points contributor', () => {
      const contributors = [
        createContributor('alice', 0),
        createContributor('bob', 100),
      ];

      const poolAmount = toMicroUnits(1000);
      const rewards = distributePerformancePool(
        contributors,
        poolAmount,
        DEFAULT_REWARD_CONFIG
      );

      // Alice has 0 points, gets 0
      expect(rewards.get('alice')).toBe(0n);
      // Bob gets entire pool
      expect(rewards.get('bob')).toBe(poolAmount);
    });

    it('should be deterministic', () => {
      const contributors = [
        createContributor('alice', 130),
        createContributor('bob', 60),
        createContributor('charlie', 10),
      ];

      const poolAmount = toMicroUnits(17600);

      const rewards1 = distributePerformancePool(
        contributors,
        poolAmount,
        DEFAULT_REWARD_CONFIG
      );
      const rewards2 = distributePerformancePool(
        contributors,
        poolAmount,
        DEFAULT_REWARD_CONFIG
      );
      const rewards3 = distributePerformancePool(
        contributors,
        poolAmount,
        DEFAULT_REWARD_CONFIG
      );

      expect(rewards1.get('alice')).toBe(rewards2.get('alice'));
      expect(rewards2.get('alice')).toBe(rewards3.get('alice'));
      expect(rewards1.get('bob')).toBe(rewards2.get('bob'));
      expect(rewards2.get('bob')).toBe(rewards3.get('bob'));
    });
  });

  describe('calculateDailyRewards', () => {
    it('should combine base and performance pools', () => {
      const contributors = [
        createContributor('alice', 100),
        createContributor('bob', 400),
      ];

      const rewards = calculateDailyRewards(contributors, DEFAULT_REWARD_CONFIG);

      expect(rewards).toHaveLength(2);

      // Each gets 2200 from base pool (4400 / 2)
      // Performance pool distributed by sqrt: alice gets ~7155, bob gets ~10445
      const alice = rewards.find(r => r.accountId === 'alice')!;
      const bob = rewards.find(r => r.accountId === 'bob')!;

      expect(alice.basePoolReward).toBeCloseTo(2200, 1);
      expect(bob.basePoolReward).toBeCloseTo(2200, 1);

      // Total should be close to daily emissions
      const total = rewards.reduce((sum, r) => sum + r.totalReward, 0);
      expect(total).toBeCloseTo(22000, 0);
    });

    it('should have exact sum (no rounding errors)', () => {
      const contributors = [
        createContributor('alice', 130),
        createContributor('bob', 60),
        createContributor('charlie', 10),
      ];

      const rewards = calculateDailyRewards(contributors, DEFAULT_REWARD_CONFIG);

      // Convert back to microunits for exact comparison
      const totalMicro = rewards.reduce((sum, r) => {
        return sum + toMicroUnits(r.totalReward);
      }, 0n);

      const expectedMicro = toMicroUnits(DEFAULT_REWARD_CONFIG.dailyEmissions);

      // Should be exact (within 1 microunit due to floating conversion)
      expect(Number(totalMicro - expectedMicro)).toBeLessThanOrEqual(contributors.length);
    });

    it('should exclude inactive contributors', () => {
      const now = new Date();
      const recentFailure = new Date(now.getTime() - 23 * 60 * 60 * 1000); // 23 hours ago (within 24h block)

      const contributors = [
        createContributor('alice', 100),
        {
          ...createContributor('bob', 100),
          lastCanaryFailureTime: recentFailure, // Blocked (24h not passed yet)
        },
      ];

      const rewards = calculateDailyRewards(contributors, DEFAULT_REWARD_CONFIG, now);

      // Only Alice should get rewards
      expect(rewards).toHaveLength(1);
      expect(rewards[0].accountId).toBe('alice');
    });

    it('should generate correct reason strings', () => {
      const contributors = [createContributor('alice', 100)];
      const rewards = calculateDailyRewards(contributors, DEFAULT_REWARD_CONFIG);

      expect(rewards[0].reason).toContain('Base:');
      expect(rewards[0].reason).toContain('Performance:');
      expect(rewards[0].reason).toContain('points');
      expect(rewards[0].reason).toContain('weight');
    });
  });

  describe('calculateRewardDistribution', () => {
    it('should return complete distribution with metadata', () => {
      const contributors = [
        createContributor('alice', 100),
        createContributor('bob', 400),
      ];

      const currentTime = new Date('2024-02-01T00:00:00Z');
      const distribution = calculateRewardDistribution(
        contributors,
        DEFAULT_REWARD_CONFIG,
        currentTime
      );

      expect(distribution.date).toBe(currentTime);
      expect(distribution.config).toBe(DEFAULT_REWARD_CONFIG);
      expect(distribution.totalEmissions).toBe(22000);
      expect(distribution.basePoolTotal).toBe(4400);
      expect(distribution.performancePoolTotal).toBe(17600);
      expect(distribution.activeContributorCount).toBe(2);
      expect(distribution.rewards).toHaveLength(2);
    });

    it('should have rewards that sum to total emissions', () => {
      const contributors = [
        createContributor('alice', 100),
        createContributor('bob', 200),
        createContributor('charlie', 300),
      ];

      const distribution = calculateRewardDistribution(
        contributors,
        DEFAULT_REWARD_CONFIG
      );

      const total = distribution.rewards.reduce((sum, r) => sum + r.totalReward, 0);
      expect(total).toBeCloseTo(22000, 0);
    });
  });

  describe('verifyExactDistribution', () => {
    it('should verify exact distribution', () => {
      const contributors = [
        createContributor('alice', 100),
        createContributor('bob', 400),
      ];

      const distribution = calculateRewardDistribution(
        contributors,
        DEFAULT_REWARD_CONFIG
      );

      const result = verifyExactDistribution(distribution);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should detect invalid distribution', () => {
      const contributors = [createContributor('alice', 100)];

      const distribution = calculateRewardDistribution(
        contributors,
        DEFAULT_REWARD_CONFIG
      );

      // Manually corrupt the distribution
      distribution.rewards[0].totalReward += 0.000002; // Add tiny amount (2 microunits)

      const result = verifyExactDistribution(distribution);

      // Should detect the corruption - fixed-point provides exact verification
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Integration: Comparison with floating-point', () => {
    it('should match floating-point results closely', async () => {
      // Import floating-point version for comparison
      const floatRewards = await import('./rewardDistribution');

      const contributors = [
        createContributor('alice', 130),
        createContributor('bob', 60),
        createContributor('charlie', 10),
      ];

      const fixedResults = calculateDailyRewards(
        contributors,
        DEFAULT_REWARD_CONFIG
      );

      const floatResults = floatRewards.calculateDailyRewards(
        contributors,
        DEFAULT_REWARD_CONFIG
      );

      // Should be within 0.01 tokens of each other
      for (let i = 0; i < fixedResults.length; i++) {
        expect(fixedResults[i].totalReward).toBeCloseTo(
          floatResults[i].totalReward,
          2
        );
      }

      // But fixed-point has exact sum, float may not
      const fixedSum = fixedResults.reduce((sum, r) => sum + r.totalReward, 0);
      const floatSum = floatResults.reduce((sum: number, r: any) => sum + r.totalReward, 0);

      // Fixed-point should be exactly 22000
      expect(fixedSum).toBeCloseTo(22000, 6);

      // Float may have small error
      expect(Math.abs(floatSum - 22000)).toBeLessThanOrEqual(0.01);
    });
  });

  describe('Edge Cases', () => {
    it('should handle 100 contributors efficiently', () => {
      const contributors: Contributor[] = [];
      for (let i = 0; i < 100; i++) {
        contributors.push(createContributor(`contributor${i}`, Math.random() * 1000 + 100));
      }

      const start = Date.now();
      const rewards = calculateDailyRewards(contributors, DEFAULT_REWARD_CONFIG);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(500); // Should be fast
      expect(rewards).toHaveLength(100);

      // Verify exact sum
      const total = rewards.reduce((sum, r) => sum + r.totalReward, 0);
      expect(total).toBeCloseTo(22000, 0);
    });

    it('should handle very large point values', () => {
      const contributors = [
        createContributor('whale', 1_000_000),
        createContributor('shrimp', 1),
      ];

      const rewards = calculateDailyRewards(contributors, DEFAULT_REWARD_CONFIG);

      // Whale should get more, but not all
      const whale = rewards.find(r => r.accountId === 'whale')!;
      const shrimp = rewards.find(r => r.accountId === 'shrimp')!;

      expect(whale.totalReward).toBeGreaterThan(shrimp.totalReward);
      expect(shrimp.totalReward).toBeGreaterThan(0);

      // sqrt ensures diminishing returns
      const whalePerPoint = whale.totalReward / 1_000_000;
      const shrimpPerPoint = shrimp.totalReward / 1;
      expect(shrimpPerPoint).toBeGreaterThan(whalePerPoint);
    });

    it('should never lose microunits across multiple days', () => {
      const contributors = [
        createContributor('alice', 100),
        createContributor('bob', 200),
      ];

      const day1 = calculateDailyRewards(contributors, DEFAULT_REWARD_CONFIG);
      const day2 = calculateDailyRewards(contributors, DEFAULT_REWARD_CONFIG);
      const day3 = calculateDailyRewards(contributors, DEFAULT_REWARD_CONFIG);

      // Each day should have exact sum
      for (const dayRewards of [day1, day2, day3]) {
        const total = dayRewards.reduce((sum, r) => sum + r.totalReward, 0);
        expect(total).toBeCloseTo(22000, 6);
      }
    });
  });
});

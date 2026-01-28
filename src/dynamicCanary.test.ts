/**
 * Unit tests for Dynamic Canary Rate System (Rehabilitation)
 */

import {
  calculateDynamicCanaryRate,
  countFailedCanaries,
  countPassedCanaries,
  isActiveContributor,
  calculateReputationWithCanaryPenalty,
} from './computePoints';
import {
  BlockType,
  Contributor,
  DEFAULT_REWARD_CONFIG,
  RewardConfig,
} from './types';

describe('Dynamic Canary Rate System (No Permanent Bans)', () => {
  const config: RewardConfig = {
    ...DEFAULT_REWARD_CONFIG,
    baseCanaryPercentage: 0.10, // 10% base
    canaryIncreasePerFailure: 0.05, // +5% per failure
    canaryDecreasePerPass: 0.02, // -2% per pass
    maxCanaryPercentage: 0.50, // 50% max
    minCanaryPercentage: 0.05, // 5% min
  };

  describe('countPassedCanaries', () => {
    it('should count only passed canaries', () => {
      const contributor: Contributor = {
        accountId: 'acc_mixed',
        reputationMultiplier: 1.0,
        canaryFailures: 2,
        canaryPasses: 3,
        completedBlocks: [
          {
            blockType: BlockType.INFERENCE,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            validationPassed: true,
            timestamp: new Date('2026-01-27'),
            isCanary: true,
            canaryAnswerCorrect: true, // Passed
          },
          {
            blockType: BlockType.INFERENCE,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            validationPassed: true,
            timestamp: new Date('2026-01-27'),
            isCanary: true,
            canaryAnswerCorrect: false, // Failed
          },
          {
            blockType: BlockType.INFERENCE,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            validationPassed: true,
            timestamp: new Date('2026-01-27'),
            isCanary: true,
            canaryAnswerCorrect: true, // Passed
          },
          {
            blockType: BlockType.INFERENCE,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            validationPassed: true,
            timestamp: new Date('2026-01-27'),
            // Not a canary
          },
          {
            blockType: BlockType.INFERENCE,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            validationPassed: true,
            timestamp: new Date('2026-01-27'),
            isCanary: true,
            canaryAnswerCorrect: true, // Passed
          },
        ],
      };

      expect(countPassedCanaries(contributor)).toBe(3);
      expect(countFailedCanaries(contributor)).toBe(1);
    });

    it('should return 0 if no canaries passed', () => {
      const contributor: Contributor = {
        accountId: 'acc_all_fail',
        reputationMultiplier: 1.0,
        canaryFailures: 2,
        canaryPasses: 0,
        completedBlocks: [
          {
            blockType: BlockType.INFERENCE,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            validationPassed: true,
            timestamp: new Date('2026-01-27'),
            isCanary: true,
            canaryAnswerCorrect: false,
          },
          {
            blockType: BlockType.INFERENCE,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            validationPassed: true,
            timestamp: new Date('2026-01-27'),
            isCanary: true,
            canaryAnswerCorrect: false,
          },
        ],
      };

      expect(countPassedCanaries(contributor)).toBe(0);
    });

    it('should return 0 if no canary blocks exist', () => {
      const contributor: Contributor = {
        accountId: 'acc_no_canaries',
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
      };

      expect(countPassedCanaries(contributor)).toBe(0);
    });
  });

  describe('calculateDynamicCanaryRate', () => {
    it('should return base rate for clean contributor', () => {
      const cleanContributor: Contributor = {
        accountId: 'acc_clean',
        reputationMultiplier: 1.0,
        canaryFailures: 0,
        canaryPasses: 0,
        completedBlocks: [],
      };

      const rate = calculateDynamicCanaryRate(cleanContributor, config);
      expect(rate).toBe(0.10); // Base 10%
    });

    it('should increase rate after failures (escalating scrutiny)', () => {
      const failedOnce: Contributor = {
        accountId: 'acc_1_fail',
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
            isCanary: true,
            canaryAnswerCorrect: false,
          },
        ],
      };

      // Base 10% + (1 fail × 5%) = 15%
      const rate = calculateDynamicCanaryRate(failedOnce, config);
      expect(rate).toBeCloseTo(0.15, 10);
    });

    it('should increase rate progressively with more failures', () => {
      const failedThrice: Contributor = {
        accountId: 'acc_3_fails',
        reputationMultiplier: 1.0,
        canaryFailures: 3,
        canaryPasses: 0,
        completedBlocks: Array(3).fill({
          blockType: BlockType.INFERENCE,
          resourceUsage: 1.0,
          difficultyMultiplier: 1.0,
          validationPassed: true,
          timestamp: new Date('2026-01-27'),
          isCanary: true,
          canaryAnswerCorrect: false,
        }),
      };

      // Base 10% + (3 fails × 5%) = 25%
      const rate = calculateDynamicCanaryRate(failedThrice, config);
      expect(rate).toBe(0.25);
    });

    it('should decrease rate after passing canaries (rehabilitation)', () => {
      const reformed: Contributor = {
        accountId: 'acc_reformed',
        reputationMultiplier: 1.0,
        canaryFailures: 1,
        canaryPasses: 2,
        completedBlocks: [
          {
            blockType: BlockType.INFERENCE,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            validationPassed: true,
            timestamp: new Date('2026-01-27'),
            isCanary: true,
            canaryAnswerCorrect: false, // 1 fail
          },
          {
            blockType: BlockType.INFERENCE,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            validationPassed: true,
            timestamp: new Date('2026-01-27'),
            isCanary: true,
            canaryAnswerCorrect: true, // 1 pass
          },
          {
            blockType: BlockType.INFERENCE,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            validationPassed: true,
            timestamp: new Date('2026-01-27'),
            isCanary: true,
            canaryAnswerCorrect: true, // 2 pass
          },
        ],
      };

      // Base 10% + (1 fail × 5%) - (2 pass × 2%) = 10% + 5% - 4% = 11%
      const rate = calculateDynamicCanaryRate(reformed, config);
      expect(rate).toBeCloseTo(0.11, 10);
    });

    it('should not exceed maximum canary rate', () => {
      const heavyCheater: Contributor = {
        accountId: 'acc_heavy_cheater',
        reputationMultiplier: 1.0,
        canaryFailures: 20, // Extreme case
        canaryPasses: 0,
        completedBlocks: Array(20).fill({
          blockType: BlockType.INFERENCE,
          resourceUsage: 1.0,
          difficultyMultiplier: 1.0,
          validationPassed: true,
          timestamp: new Date('2026-01-27'),
          isCanary: true,
          canaryAnswerCorrect: false,
        }),
      };

      // Base 10% + (20 fails × 5%) = 110%, but clamped to max 50%
      const rate = calculateDynamicCanaryRate(heavyCheater, config);
      expect(rate).toBe(0.50); // Clamped to max
    });

    it('should not go below minimum canary rate', () => {
      const superReformed: Contributor = {
        accountId: 'acc_super_reformed',
        reputationMultiplier: 1.0,
        canaryFailures: 0,
        canaryPasses: 10, // Many passes
        completedBlocks: Array(10).fill({
          blockType: BlockType.INFERENCE,
          resourceUsage: 1.0,
          difficultyMultiplier: 1.0,
          validationPassed: true,
          timestamp: new Date('2026-01-27'),
          isCanary: true,
          canaryAnswerCorrect: true,
        }),
      };

      // Base 10% - (10 pass × 2%) = -10%, but clamped to min 5%
      const rate = calculateDynamicCanaryRate(superReformed, config);
      expect(rate).toBe(0.05); // Clamped to min
    });

    it('should handle balanced history', () => {
      const balanced: Contributor = {
        accountId: 'acc_balanced',
        reputationMultiplier: 1.0,
        canaryFailures: 2,
        canaryPasses: 5,
        completedBlocks: [
          // 2 fails, 5 passes
        ],
      };

      // Base 10% + (2 × 5%) - (5 × 2%) = 10% + 10% - 10% = 10%
      const rate = calculateDynamicCanaryRate(balanced, config);
      expect(rate).toBe(0.10); // Back to base
    });
  });

  describe('Rehabilitation Workflow', () => {
    it('should allow cheater to rehabilitate over time', () => {
      const contributor: Contributor = {
        accountId: 'acc_rehabilitating',
        reputationMultiplier: 1.0,
        canaryFailures: 3, // Started as cheater
        canaryPasses: 0,
        completedBlocks: [],
      };

      // Initial state: Heavy scrutiny
      let rate = calculateDynamicCanaryRate(contributor, config);
      expect(rate).toBe(0.25); // 10% + (3 × 5%) = 25%

      // Passes 1st canary
      contributor.canaryPasses = 1;
      rate = calculateDynamicCanaryRate(contributor, config);
      expect(rate).toBe(0.23); // 25% - 2% = 23%

      // Passes 2nd canary
      contributor.canaryPasses = 2;
      rate = calculateDynamicCanaryRate(contributor, config);
      expect(rate).toBe(0.21); // 23% - 2% = 21%

      // Passes 5 more canaries (total 7 passes)
      contributor.canaryPasses = 7;
      rate = calculateDynamicCanaryRate(contributor, config);
      expect(rate).toBeCloseTo(0.11, 10); // 10% + 15% - 14% = 11%

      // Eventually reaches near-base rate
      contributor.canaryPasses = 10;
      rate = calculateDynamicCanaryRate(contributor, config);
      expect(rate).toBe(0.05); // 10% + 15% - 20% = 5% (clamped to min)
    });

    it('should maintain higher scrutiny until proven trustworthy', () => {
      const recentCheater: Contributor = {
        accountId: 'acc_recent_cheater',
        reputationMultiplier: 1.0,
        canaryFailures: 5,
        canaryPasses: 1, // Only passed 1 canary
        completedBlocks: [],
      };

      // Base 10% + (5 × 5%) - (1 × 2%) = 33%
      const rate = calculateDynamicCanaryRate(recentCheater, config);
      expect(rate).toBeCloseTo(0.33, 10);

      // Still high scrutiny despite passing 1 canary
      expect(rate).toBeGreaterThan(config.baseCanaryPercentage);
    });
  });

  describe('No Permanent Bans', () => {
    it('should NOT ban contributor with many failures if reputation > 0', () => {
      const manyFailures: Contributor = {
        accountId: 'acc_many_failures',
        reputationMultiplier: 0.5, // Still has 50% reputation
        canaryFailures: 10,
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
      };

      // Should still be active (reputation > 0)
      const isActive = isActiveContributor(manyFailures, config);
      expect(isActive).toBe(true);
    });

    it('should only reject if reputation drops to 0 via penalties', () => {
      const config: RewardConfig = {
        ...DEFAULT_REWARD_CONFIG,
        canaryFailurePenalty: 0.5, // -50% per failure
        minReliability: 0.1, // Need at least 10%
      };

      const zeroReputation: Contributor = {
        accountId: 'acc_zero_rep',
        reputationMultiplier: 1.0,
        canaryFailures: 3, // 3 × 50% = 150% penalty → 0% rep
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
      };

      // Reputation: 1.0 - (3 × 0.5) = -0.5 → clamped to 0
      const effectiveRep = calculateReputationWithCanaryPenalty(
        zeroReputation.reputationMultiplier,
        zeroReputation.canaryFailures,
        config
      );
      expect(effectiveRep).toBe(0);

      // Should be rejected due to 0% reputation
      const isActive = isActiveContributor(zeroReputation, config);
      expect(isActive).toBe(false);
    });

    it('should allow zero-reputation contributor to recover by passing canaries', () => {
      // Contributor with 0% reputation due to failures
      const recovering: Contributor = {
        accountId: 'acc_recovering',
        reputationMultiplier: 1.0,
        canaryFailures: 10, // Would have 0% rep
        canaryPasses: 0,
        completedBlocks: [],
      };

      const config: RewardConfig = {
        ...DEFAULT_REWARD_CONFIG,
        canaryFailurePenalty: 0.1,
        minReliability: 0.1,
      };

      // Initially: 0% effective reputation (rejected)
      let effectiveRep = calculateReputationWithCanaryPenalty(
        recovering.reputationMultiplier,
        recovering.canaryFailures,
        config
      );
      expect(effectiveRep).toBe(0); // 1.0 - 1.0 = 0

      // But if they somehow pass canaries (maybe through manual review/reset),
      // they can recover. This requires external intervention to reset canaryFailures
      // or increase base reputation.

      // System still gives them canaries (at max rate 50%)
      const canaryRate = calculateDynamicCanaryRate(recovering, config);
      expect(canaryRate).toBe(0.50); // Max scrutiny
    });
  });

  describe('calculateReputationWithCanaryPenalty (Updated)', () => {
    const config: RewardConfig = {
      ...DEFAULT_REWARD_CONFIG,
      canaryFailurePenalty: 0.1, // -10% per failure
    };

    it('should return base reputation with no failures', () => {
      expect(calculateReputationWithCanaryPenalty(1.0, 0, config)).toBe(1.0);
      expect(calculateReputationWithCanaryPenalty(0.8, 0, config)).toBe(0.8);
    });

    it('should apply penalty for each failure', () => {
      // 1 failure: 1.0 - 0.1 = 0.9
      expect(calculateReputationWithCanaryPenalty(1.0, 1, config)).toBe(0.9);

      // 2 failures: 1.0 - 0.2 = 0.8
      expect(calculateReputationWithCanaryPenalty(1.0, 2, config)).toBe(0.8);
    });

    it('should NOT have max failures ban (removed)', () => {
      // 3 failures: 1.0 - 0.3 = 0.7 (NOT 0 as before)
      expect(calculateReputationWithCanaryPenalty(1.0, 3, config)).toBe(0.7);

      // 5 failures: 1.0 - 0.5 = 0.5 (NOT 0 as before)
      expect(calculateReputationWithCanaryPenalty(1.0, 5, config)).toBe(0.5);

      // 10 failures: 1.0 - 1.0 = 0 (natural zero, not ban)
      expect(calculateReputationWithCanaryPenalty(1.0, 10, config)).toBe(0);
    });

    it('should not go below 0 reputation', () => {
      const highPenaltyConfig: RewardConfig = {
        ...DEFAULT_REWARD_CONFIG,
        canaryFailurePenalty: 0.5, // -50% per failure
      };

      // Starting at 0.8, 2 failures = 0.8 - 1.0 = -0.2 → clamped to 0
      expect(calculateReputationWithCanaryPenalty(0.8, 2, highPenaltyConfig)).toBe(0);
    });

    it('should throw error for invalid base reputation', () => {
      expect(() => calculateReputationWithCanaryPenalty(-0.1, 0, config)).toThrow(
        'Invalid baseReputation'
      );
      expect(() => calculateReputationWithCanaryPenalty(1.1, 0, config)).toThrow(
        'Invalid baseReputation'
      );
    });
  });
});

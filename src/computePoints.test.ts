/**
 * Unit tests for Compute Points calculation
 */

import {
  calculateBlockPoints,
  calculateTotalComputePoints,
  calculateRewardPoints,
  calculateEffectiveComputePoints,
  isActiveContributor,
  calculateReputationWithCanaryPenalty,
  countFailedCanaries,
  getMostRecentCanaryFailureTime,
  isBlockedByRecentCanaryFailure,
} from './computePoints';
import {
  BlockType,
  CompletedBlock,
  Contributor,
  DEFAULT_REWARD_CONFIG,
  RewardConfig,
} from './types';

describe('calculateBlockPoints', () => {
  it('should calculate points for a valid inference block', () => {
    const block: CompletedBlock = {
      blockType: BlockType.INFERENCE,
      resourceUsage: 0.8,
      difficultyMultiplier: 1.5,
      validationPassed: true,
      timestamp: new Date('2026-01-27'),
    };

    // Expected: 10 (base) × 0.8 × 1.5 × 1 (validated) = 12
    expect(calculateBlockPoints(block)).toBe(12);
  });

  it('should return 0 points for failed validation', () => {
    const block: CompletedBlock = {
      blockType: BlockType.TRAINING,
      resourceUsage: 1.0,
      difficultyMultiplier: 2.0,
      validationPassed: false, // Failed
      timestamp: new Date('2026-01-27'),
    };

    // Validation failed = 0 points regardless of other factors
    expect(calculateBlockPoints(block)).toBe(0);
  });

  it('should handle different block types correctly', () => {
    const baseBlock = {
      resourceUsage: 1.0,
      difficultyMultiplier: 1.0,
      validationPassed: true,
      timestamp: new Date('2026-01-27'),
    };

    expect(calculateBlockPoints({ ...baseBlock, blockType: BlockType.INFERENCE })).toBe(10);
    expect(calculateBlockPoints({ ...baseBlock, blockType: BlockType.EMBEDDINGS })).toBe(8);
    expect(calculateBlockPoints({ ...baseBlock, blockType: BlockType.VALIDATION })).toBe(5);
    expect(calculateBlockPoints({ ...baseBlock, blockType: BlockType.TRAINING })).toBe(15);
  });

  it('should throw error for invalid resource usage < 0', () => {
    const block: CompletedBlock = {
      blockType: BlockType.INFERENCE,
      resourceUsage: -0.1,
      difficultyMultiplier: 1.0,
      validationPassed: true,
      timestamp: new Date('2026-01-27'),
    };

    expect(() => calculateBlockPoints(block)).toThrow('Invalid resourceUsage');
  });

  it('should throw error for invalid resource usage > 1', () => {
    const block: CompletedBlock = {
      blockType: BlockType.INFERENCE,
      resourceUsage: 1.1,
      difficultyMultiplier: 1.0,
      validationPassed: true,
      timestamp: new Date('2026-01-27'),
    };

    expect(() => calculateBlockPoints(block)).toThrow('Invalid resourceUsage');
  });

  it('should throw error for difficulty multiplier < 1', () => {
    const block: CompletedBlock = {
      blockType: BlockType.INFERENCE,
      resourceUsage: 0.5,
      difficultyMultiplier: 0.9,
      validationPassed: true,
      timestamp: new Date('2026-01-27'),
    };

    expect(() => calculateBlockPoints(block)).toThrow('Invalid difficultyMultiplier');
  });

  it('should handle edge case: minimal valid block', () => {
    const block: CompletedBlock = {
      blockType: BlockType.VALIDATION,
      resourceUsage: 0.0, // Minimal resource
      difficultyMultiplier: 1.0,
      validationPassed: true,
      timestamp: new Date('2026-01-27'),
    };

    // 5 × 0 × 1 × 1 = 0 (but still valid)
    expect(calculateBlockPoints(block)).toBe(0);
  });
});

describe('calculateTotalComputePoints', () => {
  it('should sum points from multiple blocks', () => {
    const contributor: Contributor = {
      accountId: 'acc_123',
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
        {
          blockType: BlockType.EMBEDDINGS,
          resourceUsage: 0.5,
          difficultyMultiplier: 2.0,
          validationPassed: true,
          timestamp: new Date('2026-01-27'),
        },
      ],
    };

    // Block 1: 10 × 1.0 × 1.0 = 10
    // Block 2: 8 × 0.5 × 2.0 = 8
    // Total: 18
    expect(calculateTotalComputePoints(contributor)).toBe(18);
  });

  it('should return 0 for contributor with no blocks', () => {
    const contributor: Contributor = {
      accountId: 'acc_empty',
      reputationMultiplier: 1.0,
      canaryFailures: 0,
      canaryPasses: 0,
      completedBlocks: [],
    };

    expect(calculateTotalComputePoints(contributor)).toBe(0);
  });

  it('should exclude failed validation blocks from total', () => {
    const contributor: Contributor = {
      accountId: 'acc_mixed',
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
        {
          blockType: BlockType.INFERENCE,
          resourceUsage: 1.0,
          difficultyMultiplier: 1.0,
          validationPassed: false, // Failed
          timestamp: new Date('2026-01-27'),
        },
      ],
    };

    // Only first block counts: 10
    expect(calculateTotalComputePoints(contributor)).toBe(10);
  });
});

describe('calculateRewardPoints', () => {
  it('should exclude all canary blocks from reward calculation', () => {
    const contributor: Contributor = {
      accountId: 'acc_123',
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
          isCanary: false, // Regular block
        },
        {
          blockType: BlockType.INFERENCE,
          resourceUsage: 1.0,
          difficultyMultiplier: 1.0,
          validationPassed: true,
          timestamp: new Date('2026-01-27'),
          isCanary: true, // Passed canary - still excluded
          canaryAnswerCorrect: true,
        },
        {
          blockType: BlockType.INFERENCE,
          resourceUsage: 1.0,
          difficultyMultiplier: 1.0,
          validationPassed: true,
          timestamp: new Date('2026-01-27'),
          isCanary: false, // Regular block
        },
      ],
    };

    // Only 2 regular blocks count: 10 + 10 = 20
    // Canary block is excluded even though it was passed
    expect(calculateRewardPoints(contributor)).toBe(20);
  });

  it('should exclude failed canary blocks from rewards', () => {
    const contributor: Contributor = {
      accountId: 'acc_failed',
      reputationMultiplier: 1.0,
      canaryFailures: 1,
      canaryPasses: 0,
      completedBlocks: [
        {
          blockType: BlockType.TRAINING,
          resourceUsage: 1.0,
          difficultyMultiplier: 1.0,
          validationPassed: true,
          timestamp: new Date('2026-01-27'),
          isCanary: false,
        },
        {
          blockType: BlockType.INFERENCE,
          resourceUsage: 1.0,
          difficultyMultiplier: 1.0,
          validationPassed: true,
          timestamp: new Date('2026-01-27'),
          isCanary: true, // Failed canary
          canaryAnswerCorrect: false,
        },
      ],
    };

    // Only the TRAINING block counts: 15
    // Failed canary is excluded
    expect(calculateRewardPoints(contributor)).toBe(15);
  });

  it('should count only real work blocks, not validation blocks', () => {
    const contributor: Contributor = {
      accountId: 'acc_mixed',
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
          isCanary: false,
        },
        {
          blockType: BlockType.INFERENCE,
          resourceUsage: 1.0,
          difficultyMultiplier: 1.0,
          validationPassed: true,
          timestamp: new Date('2026-01-27'),
          isCanary: true, // Passed canary 1
          canaryAnswerCorrect: true,
        },
        {
          blockType: BlockType.TRAINING,
          resourceUsage: 1.0,
          difficultyMultiplier: 1.0,
          validationPassed: true,
          timestamp: new Date('2026-01-27'),
          isCanary: false,
        },
        {
          blockType: BlockType.INFERENCE,
          resourceUsage: 1.0,
          difficultyMultiplier: 1.0,
          validationPassed: true,
          timestamp: new Date('2026-01-27'),
          isCanary: true, // Passed canary 2
          canaryAnswerCorrect: true,
        },
        {
          blockType: BlockType.EMBEDDINGS,
          resourceUsage: 1.0,
          difficultyMultiplier: 1.0,
          validationPassed: true,
          timestamp: new Date('2026-01-27'),
          isCanary: false,
        },
      ],
    };

    // Real work: INFERENCE (10) + TRAINING (15) + EMBEDDINGS (8) = 33
    // 2 passed canaries are excluded
    expect(calculateRewardPoints(contributor)).toBe(33);
  });

  it('should return 0 if all blocks are canaries', () => {
    const contributor: Contributor = {
      accountId: 'acc_only_canaries',
      reputationMultiplier: 1.0,
      canaryFailures: 0,
      canaryPasses: 3,
      completedBlocks: [
        {
          blockType: BlockType.INFERENCE,
          resourceUsage: 1.0,
          difficultyMultiplier: 1.0,
          validationPassed: true,
          timestamp: new Date('2026-01-27'),
          isCanary: true,
          canaryAnswerCorrect: true,
        },
        {
          blockType: BlockType.INFERENCE,
          resourceUsage: 1.0,
          difficultyMultiplier: 1.0,
          validationPassed: true,
          timestamp: new Date('2026-01-27'),
          isCanary: true,
          canaryAnswerCorrect: true,
        },
        {
          blockType: BlockType.INFERENCE,
          resourceUsage: 1.0,
          difficultyMultiplier: 1.0,
          validationPassed: true,
          timestamp: new Date('2026-01-27'),
          isCanary: true,
          canaryAnswerCorrect: true,
        },
      ],
    };

    // All canaries - no reward points
    expect(calculateRewardPoints(contributor)).toBe(0);
  });

  it('should return 0 for contributor with no blocks', () => {
    const contributor: Contributor = {
      accountId: 'acc_empty',
      reputationMultiplier: 1.0,
      canaryFailures: 0,
      canaryPasses: 0,
      completedBlocks: [],
    };

    expect(calculateRewardPoints(contributor)).toBe(0);
  });

  it('should differ from calculateTotalComputePoints when canaries present', () => {
    const contributor: Contributor = {
      accountId: 'acc_compare',
      reputationMultiplier: 1.0,
      canaryFailures: 0,
      canaryPasses: 1,
      completedBlocks: [
        {
          blockType: BlockType.INFERENCE,
          resourceUsage: 1.0,
          difficultyMultiplier: 1.0,
          validationPassed: true,
          timestamp: new Date('2026-01-27'),
          isCanary: false,
        },
        {
          blockType: BlockType.INFERENCE,
          resourceUsage: 1.0,
          difficultyMultiplier: 1.0,
          validationPassed: true,
          timestamp: new Date('2026-01-27'),
          isCanary: true, // Passed canary
          canaryAnswerCorrect: true,
        },
      ],
    };

    const totalPoints = calculateTotalComputePoints(contributor);
    const rewardPoints = calculateRewardPoints(contributor);

    // Total points includes passed canary: 10 + 10 = 20
    expect(totalPoints).toBe(20);

    // Reward points excludes canary: 10 only
    expect(rewardPoints).toBe(10);

    // They should differ
    expect(rewardPoints).toBeLessThan(totalPoints);
  });
});

describe('calculateEffectiveComputePoints', () => {
  it('should apply reputation multiplier to raw points', () => {
    const contributor: Contributor = {
      accountId: 'acc_good',
      reputationMultiplier: 0.8, // 20% penalty
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

    // Raw: 10, Effective: 10 × 0.8 = 8
    expect(calculateEffectiveComputePoints(contributor)).toBe(8);
  });

  it('should return 0 for zero reputation (bad actor)', () => {
    const contributor: Contributor = {
      accountId: 'acc_bad',
      reputationMultiplier: 0.0, // Complete penalty
      canaryFailures: 0,
      canaryPasses: 0,
      completedBlocks: [
        {
          blockType: BlockType.TRAINING,
          resourceUsage: 1.0,
          difficultyMultiplier: 2.0,
          validationPassed: true,
          timestamp: new Date('2026-01-27'),
        },
      ],
    };

    // Raw: 30, Effective: 30 × 0 = 0
    expect(calculateEffectiveComputePoints(contributor)).toBe(0);
  });

  it('should handle perfect reputation (1.0)', () => {
    const contributor: Contributor = {
      accountId: 'acc_perfect',
      reputationMultiplier: 1.0,
      canaryFailures: 0,
      canaryPasses: 0,
      completedBlocks: [
        {
          blockType: BlockType.VALIDATION,
          resourceUsage: 0.6,
          difficultyMultiplier: 1.2,
          validationPassed: true,
          timestamp: new Date('2026-01-27'),
        },
      ],
    };

    // Raw: 5 × 0.6 × 1.2 = 3.6, Effective: 3.6 × 1.0 = 3.6
    expect(calculateEffectiveComputePoints(contributor)).toBeCloseTo(3.6, 10);
  });
});

describe('isActiveContributor', () => {
  const config: RewardConfig = {
    ...DEFAULT_REWARD_CONFIG,
    minBlocksForActive: 1,
    minReliability: 0.5,
  };

  it('should return true for valid active contributor', () => {
    const contributor: Contributor = {
      accountId: 'acc_active',
      reputationMultiplier: 0.8, // Above minimum
      canaryFailures: 0,
      canaryPasses: 0,
      completedBlocks: [
        {
          blockType: BlockType.INFERENCE,
          resourceUsage: 0.5,
          difficultyMultiplier: 1.0,
          validationPassed: true,
          timestamp: new Date('2026-01-27'),
        },
      ],
    };

    expect(isActiveContributor(contributor, config)).toBe(true);
  });

  it('should return false if reputation below threshold', () => {
    const contributor: Contributor = {
      accountId: 'acc_lowrep',
      reputationMultiplier: 0.3, // Below 0.5 minimum
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

    expect(isActiveContributor(contributor, config)).toBe(false);
  });

  it('should return false if not enough validated blocks', () => {
    const contributor: Contributor = {
      accountId: 'acc_novalidation',
      reputationMultiplier: 1.0,
      canaryFailures: 0,
      canaryPasses: 0,
      completedBlocks: [
        {
          blockType: BlockType.INFERENCE,
          resourceUsage: 1.0,
          difficultyMultiplier: 1.0,
          validationPassed: false, // Failed
          timestamp: new Date('2026-01-27'),
        },
      ],
    };

    expect(isActiveContributor(contributor, config)).toBe(false);
  });

  it('should return false if no effective points earned', () => {
    const contributor: Contributor = {
      accountId: 'acc_nopoints',
      reputationMultiplier: 0.0, // Zero reputation = zero effective points
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

    expect(isActiveContributor(contributor, config)).toBe(false);
  });

  it('should handle multiple validated blocks correctly', () => {
    const contributor: Contributor = {
      accountId: 'acc_multiple',
      reputationMultiplier: 0.9,
      canaryFailures: 0,
      canaryPasses: 0,
      completedBlocks: [
        {
          blockType: BlockType.INFERENCE,
          resourceUsage: 0.8,
          difficultyMultiplier: 1.0,
          validationPassed: true,
          timestamp: new Date('2026-01-27'),
        },
        {
          blockType: BlockType.EMBEDDINGS,
          resourceUsage: 0.6,
          difficultyMultiplier: 1.2,
          validationPassed: true,
          timestamp: new Date('2026-01-27'),
        },
      ],
    };

    expect(isActiveContributor(contributor, config)).toBe(true);
  });

  it('should return false for empty blocks list', () => {
    const contributor: Contributor = {
      accountId: 'acc_empty',
      reputationMultiplier: 1.0,
      completedBlocks: [],
      canaryFailures: 0,
      canaryPasses: 0,
    };

    expect(isActiveContributor(contributor, config)).toBe(false);
  });
});

describe('Canary Block Anti-Gaming Tests', () => {
  describe('calculateBlockPoints with canary blocks', () => {
    it('should award normal points for correctly answered canary', () => {
      const canaryBlock: CompletedBlock = {
        blockType: BlockType.INFERENCE,
        resourceUsage: 1.0,
        difficultyMultiplier: 1.0,
        validationPassed: true,
        timestamp: new Date('2026-01-27'),
        isCanary: true,
        canaryAnswerCorrect: true, // Answered correctly
      };

      // Should get full points: 10 × 1.0 × 1.0 = 10
      expect(calculateBlockPoints(canaryBlock)).toBe(10);
    });

    it('should award 0 points for incorrectly answered canary', () => {
      const canaryBlock: CompletedBlock = {
        blockType: BlockType.TRAINING,
        resourceUsage: 1.0,
        difficultyMultiplier: 2.0,
        validationPassed: true,
        timestamp: new Date('2026-01-27'),
        isCanary: true,
        canaryAnswerCorrect: false, // Failed canary (cheater detected!)
      };

      // Failed canary = 0 points regardless of other factors
      expect(calculateBlockPoints(canaryBlock)).toBe(0);
    });

    it('should throw error if canary block missing canaryAnswerCorrect field', () => {
      const invalidCanary: CompletedBlock = {
        blockType: BlockType.INFERENCE,
        resourceUsage: 1.0,
        difficultyMultiplier: 1.0,
        validationPassed: true,
        timestamp: new Date('2026-01-27'),
        isCanary: true,
        // Missing canaryAnswerCorrect!
      };

      expect(() => calculateBlockPoints(invalidCanary)).toThrow(
        'Canary block must have canaryAnswerCorrect field set'
      );
    });

    it('should handle non-canary blocks normally (no canary fields)', () => {
      const normalBlock: CompletedBlock = {
        blockType: BlockType.EMBEDDINGS,
        resourceUsage: 0.5,
        difficultyMultiplier: 1.5,
        validationPassed: true,
        timestamp: new Date('2026-01-27'),
        // No canary fields
      };

      // Normal calculation: 8 × 0.5 × 1.5 = 6
      expect(calculateBlockPoints(normalBlock)).toBe(6);
    });
  });

  describe('countFailedCanaries', () => {
    it('should count only failed canaries', () => {
      const contributor: Contributor = {
        accountId: 'acc_mixed_canaries',
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
            // Not a canary
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
        ],
      };

      expect(countFailedCanaries(contributor)).toBe(2);
    });

    it('should return 0 if no canaries failed', () => {
      const contributor: Contributor = {
        accountId: 'acc_honest',
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
            isCanary: true,
            canaryAnswerCorrect: true,
          },
          {
            blockType: BlockType.INFERENCE,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            validationPassed: true,
            timestamp: new Date('2026-01-27'),
          },
        ],
      };

      expect(countFailedCanaries(contributor)).toBe(0);
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

      expect(countFailedCanaries(contributor)).toBe(0);
    });
  });

  describe('calculateReputationWithCanaryPenalty', () => {
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

    it('should NOT ban at any specific failure count (rehabilitation system)', () => {
      // 3 failures: 1.0 - 0.3 = 0.7 (NOT 0 - no hard ban)
      expect(calculateReputationWithCanaryPenalty(1.0, 3, config)).toBe(0.7);

      // 5 failures: 1.0 - 0.5 = 0.5 (still not banned)
      expect(calculateReputationWithCanaryPenalty(1.0, 5, config)).toBe(0.5);

      // 10 failures: 1.0 - 1.0 = 0 (natural zero, not hard ban)
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

  describe('isActiveContributor with canary failures (No Hard Bans)', () => {
    const config: RewardConfig = {
      ...DEFAULT_REWARD_CONFIG,
      minBlocksForActive: 1,
      minReliability: 0.5,
      canaryFailurePenalty: 0.2, // -20% per failure
    };

    it('should reject contributor only if reputation drops below threshold', () => {
      const contributor: Contributor = {
        accountId: 'acc_low_rep',
        reputationMultiplier: 1.0,
        canaryFailures: 3, // 3 failures
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

      // Effective reputation: 1.0 - (3 × 0.2) = 0.4
      // 0.4 < 0.5 minReliability, so should be rejected
      expect(isActiveContributor(contributor, config)).toBe(false);
    });

    it('should accept contributor with canary penalties but still above min reliability', () => {
      const contributor: Contributor = {
        accountId: 'acc_partial_penalty',
        reputationMultiplier: 1.0, // Base 1.0
        canaryFailures: 2, // 2 failures (historical count, not in recent blocks)
        canaryPasses: 0,
        completedBlocks: [
          {
            blockType: BlockType.INFERENCE,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            validationPassed: true,
            timestamp: new Date('2026-01-27'),
          },
          {
            blockType: BlockType.INFERENCE,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            validationPassed: true,
            timestamp: new Date('2026-01-27'),
          },
          {
            blockType: BlockType.INFERENCE,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            validationPassed: true,
            timestamp: new Date('2026-01-27'),
          },
        ],
      };

      // Effective reputation: 1.0 - (2 × 0.2) = 0.6
      // 0.6 > 0.5 minReliability, so should be active
      expect(isActiveContributor(contributor, config)).toBe(true);
    });

    it('should reject contributor whose canary penalties drop below min reliability', () => {
      const contributor: Contributor = {
        accountId: 'acc_below_threshold',
        reputationMultiplier: 0.6, // Start at 0.6
        canaryFailures: 1, // 1 failure
        canaryPasses: 0,
        completedBlocks: [
          {
            blockType: BlockType.INFERENCE,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            validationPassed: true,
            timestamp: new Date('2026-01-27'),
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

      // Effective reputation: 0.6 - (1 × 0.2) = 0.4
      // 0.4 < 0.5 minReliability, so should be rejected
      expect(isActiveContributor(contributor, config)).toBe(false);
    });
  });

  describe('24-Hour Block After Canary Failure', () => {
    describe('getMostRecentCanaryFailureTime', () => {
      it('should return undefined if no canary failures', () => {
        const contributor: Contributor = {
          accountId: 'acc_clean',
          reputationMultiplier: 1.0,
          canaryFailures: 0,
          canaryPasses: 0,
          completedBlocks: [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: new Date('2026-01-27T10:00:00Z'),
            },
          ],
        };

        expect(getMostRecentCanaryFailureTime(contributor)).toBeUndefined();
      });

      it('should return timestamp of single canary failure', () => {
        const failureTime = new Date('2026-01-27T12:00:00Z');
        const contributor: Contributor = {
          accountId: 'acc_one_failure',
          reputationMultiplier: 1.0,
          canaryFailures: 1,
          canaryPasses: 0,
          completedBlocks: [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: failureTime,
              isCanary: true,
              canaryAnswerCorrect: false,
            },
          ],
        };

        expect(getMostRecentCanaryFailureTime(contributor)).toEqual(failureTime);
      });

      it('should return most recent failure when multiple failures exist', () => {
        const olderFailure = new Date('2026-01-27T10:00:00Z');
        const newerFailure = new Date('2026-01-27T15:00:00Z');
        const contributor: Contributor = {
          accountId: 'acc_multiple_failures',
          reputationMultiplier: 1.0,
          canaryFailures: 2,
          canaryPasses: 0,
          completedBlocks: [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: olderFailure,
              isCanary: true,
              canaryAnswerCorrect: false,
            },
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: new Date('2026-01-27T12:00:00Z'),
            },
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: newerFailure,
              isCanary: true,
              canaryAnswerCorrect: false,
            },
          ],
        };

        expect(getMostRecentCanaryFailureTime(contributor)).toEqual(newerFailure);
      });

      it('should ignore passed canaries', () => {
        const failureTime = new Date('2026-01-27T10:00:00Z');
        const passTime = new Date('2026-01-27T15:00:00Z');
        const contributor: Contributor = {
          accountId: 'acc_mixed',
          reputationMultiplier: 1.0,
          canaryFailures: 1,
          canaryPasses: 1,
          completedBlocks: [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: failureTime,
              isCanary: true,
              canaryAnswerCorrect: false, // Failed
            },
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: passTime,
              isCanary: true,
              canaryAnswerCorrect: true, // Passed (ignore)
            },
          ],
        };

        // Should return the failure time, not the pass time
        expect(getMostRecentCanaryFailureTime(contributor)).toEqual(failureTime);
      });
    });

    describe('isBlockedByRecentCanaryFailure', () => {
      const config: RewardConfig = {
        ...DEFAULT_REWARD_CONFIG,
        canaryBlockDurationMs: 24 * 60 * 60 * 1000, // 24 hours
      };

      it('should return false if no canary failures', () => {
        const contributor: Contributor = {
          accountId: 'acc_clean',
          reputationMultiplier: 1.0,
          canaryFailures: 0,
          canaryPasses: 0,
          completedBlocks: [],
        };

        const currentTime = new Date('2026-01-28T10:00:00Z');
        expect(isBlockedByRecentCanaryFailure(contributor, config, currentTime)).toBe(false);
      });

      it('should return true if failure within 24 hours', () => {
        const failureTime = new Date('2026-01-27T12:00:00Z');
        const currentTime = new Date('2026-01-28T11:00:00Z'); // 23 hours later

        const contributor: Contributor = {
          accountId: 'acc_recent_failure',
          reputationMultiplier: 1.0,
          canaryFailures: 1,
          canaryPasses: 0,
          lastCanaryFailureTime: failureTime,
          completedBlocks: [],
        };

        expect(isBlockedByRecentCanaryFailure(contributor, config, currentTime)).toBe(true);
      });

      it('should return false if failure more than 24 hours ago', () => {
        const failureTime = new Date('2026-01-27T12:00:00Z');
        const currentTime = new Date('2026-01-28T12:00:01Z'); // 24 hours + 1 second later

        const contributor: Contributor = {
          accountId: 'acc_old_failure',
          reputationMultiplier: 1.0,
          canaryFailures: 1,
          canaryPasses: 0,
          lastCanaryFailureTime: failureTime,
          completedBlocks: [],
        };

        expect(isBlockedByRecentCanaryFailure(contributor, config, currentTime)).toBe(false);
      });

      it('should handle edge case: exactly 24 hours', () => {
        const failureTime = new Date('2026-01-27T12:00:00Z');
        const currentTime = new Date('2026-01-28T12:00:00Z'); // Exactly 24 hours

        const contributor: Contributor = {
          accountId: 'acc_exact_24h',
          reputationMultiplier: 1.0,
          canaryFailures: 1,
          canaryPasses: 0,
          lastCanaryFailureTime: failureTime,
          completedBlocks: [],
        };

        // At exactly 24h, should NOT be blocked (>= vs >)
        expect(isBlockedByRecentCanaryFailure(contributor, config, currentTime)).toBe(false);
      });

      it('should compute failure time from blocks if lastCanaryFailureTime not set', () => {
        const failureTime = new Date('2026-01-27T12:00:00Z');
        const currentTime = new Date('2026-01-27T18:00:00Z'); // 6 hours later

        const contributor: Contributor = {
          accountId: 'acc_computed',
          reputationMultiplier: 1.0,
          canaryFailures: 1,
          canaryPasses: 0,
          // lastCanaryFailureTime not set
          completedBlocks: [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: failureTime,
              isCanary: true,
              canaryAnswerCorrect: false,
            },
          ],
        };

        expect(isBlockedByRecentCanaryFailure(contributor, config, currentTime)).toBe(true);
      });

      it('should use most recent failure when multiple exist', () => {
        const olderFailure = new Date('2026-01-26T12:00:00Z');
        const recentFailure = new Date('2026-01-27T12:00:00Z');
        const currentTime = new Date('2026-01-27T18:00:00Z'); // 6 hours after recent failure

        const contributor: Contributor = {
          accountId: 'acc_multiple',
          reputationMultiplier: 1.0,
          canaryFailures: 2,
          canaryPasses: 0,
          completedBlocks: [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: olderFailure,
              isCanary: true,
              canaryAnswerCorrect: false,
            },
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: recentFailure,
              isCanary: true,
              canaryAnswerCorrect: false,
            },
          ],
        };

        // Should be blocked based on recent failure (6h ago), not older one
        expect(isBlockedByRecentCanaryFailure(contributor, config, currentTime)).toBe(true);
      });

      it('should support custom block durations', () => {
        const shortBlockConfig: RewardConfig = {
          ...DEFAULT_REWARD_CONFIG,
          canaryBlockDurationMs: 1 * 60 * 60 * 1000, // 1 hour
        };

        const failureTime = new Date('2026-01-27T12:00:00Z');
        const currentTime = new Date('2026-01-27T13:30:00Z'); // 1.5 hours later

        const contributor: Contributor = {
          accountId: 'acc_short_block',
          reputationMultiplier: 1.0,
          canaryFailures: 1,
          canaryPasses: 0,
          lastCanaryFailureTime: failureTime,
          completedBlocks: [],
        };

        // With 1-hour block, should NOT be blocked after 1.5 hours
        expect(isBlockedByRecentCanaryFailure(contributor, shortBlockConfig, currentTime)).toBe(false);
      });
    });

    describe('isActiveContributor with 24h block', () => {
      const config: RewardConfig = {
        ...DEFAULT_REWARD_CONFIG,
        minBlocksForActive: 1,
        minReliability: 0.5,
        canaryBlockDurationMs: 24 * 60 * 60 * 1000,
        canaryFailurePenalty: 0.1,
      };

      it('should reject contributor blocked by recent canary failure', () => {
        const failureTime = new Date('2026-01-27T12:00:00Z');
        const currentTime = new Date('2026-01-27T18:00:00Z'); // 6 hours later

        const contributor: Contributor = {
          accountId: 'acc_blocked',
          reputationMultiplier: 1.0, // Good reputation
          canaryFailures: 1,
          canaryPasses: 0,
          lastCanaryFailureTime: failureTime,
          completedBlocks: [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: new Date('2026-01-27T18:00:00Z'),
            },
          ],
        };

        // Should be rejected despite good reputation and completed work
        expect(isActiveContributor(contributor, config, currentTime)).toBe(false);
      });

      it('should accept contributor after 24h block expires', () => {
        const failureTime = new Date('2026-01-27T12:00:00Z');
        const currentTime = new Date('2026-01-28T12:00:01Z'); // 24h + 1s later

        const contributor: Contributor = {
          accountId: 'acc_unblocked',
          reputationMultiplier: 1.0,
          canaryFailures: 1,
          canaryPasses: 0,
          lastCanaryFailureTime: failureTime,
          completedBlocks: [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: new Date('2026-01-28T12:00:00Z'),
            },
          ],
        };

        // Should be accepted after block expires
        expect(isActiveContributor(contributor, config, currentTime)).toBe(true);
      });

      it('should prioritize 24h block check over other checks', () => {
        const failureTime = new Date('2026-01-27T12:00:00Z');
        const currentTime = new Date('2026-01-27T18:00:00Z');

        const contributor: Contributor = {
          accountId: 'acc_priority',
          reputationMultiplier: 1.0, // Perfect reputation
          canaryFailures: 1, // Below ban threshold
          canaryPasses: 0,
          lastCanaryFailureTime: failureTime,
          completedBlocks: [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: new Date('2026-01-27T18:00:00Z'),
            },
          ],
        };

        // Even with perfect reputation and work, 24h block takes precedence
        expect(isActiveContributor(contributor, config, currentTime)).toBe(false);
      });

      it('should allow contributor who has never failed a canary', () => {
        const currentTime = new Date('2026-01-27T18:00:00Z');

        const contributor: Contributor = {
          accountId: 'acc_clean_record',
          reputationMultiplier: 1.0,
          canaryFailures: 0,
          canaryPasses: 1,
          completedBlocks: [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              validationPassed: true,
              timestamp: new Date('2026-01-27T18:00:00Z'),
              isCanary: true,
              canaryAnswerCorrect: true, // Passed all canaries
            },
          ],
        };

        expect(isActiveContributor(contributor, config, currentTime)).toBe(true);
      });
    });
  });
});

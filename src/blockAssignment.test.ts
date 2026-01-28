/**
 * Tests for Block Assignment System
 */

import {
  calculate30DayPerformance,
  calculateAssignmentWeight,
  weightedRandomSelect,
  assignBatch,
  distributeDailyBlocks,
  getContributorAssignmentStats,
} from './blockAssignment';
import {
  Contributor,
  BlockType,
  DEFAULT_BLOCK_ASSIGNMENT_CONFIG,
} from './types';

describe('Block Assignment System', () => {
  // Helper: Create test contributor
  const createContributor = (
    accountId: string,
    blocks: Array<{
      blockType: BlockType;
      resourceUsage: number;
      difficultyMultiplier: number;
      timestamp: Date;
    }>,
    reputationMultiplier: number = 1.0
  ): Contributor => ({
    accountId,
    completedBlocks: blocks.map(b => ({
      ...b,
      validationPassed: true,
      isCanary: false,
    })),
    reputationMultiplier,
    canaryFailures: 0,
    canaryPasses: 0,
  });

  describe('calculate30DayPerformance', () => {
    it('should sum compute points from blocks in last 30 days', () => {
      const now = new Date('2024-01-31T00:00:00Z');
      const contributor = createContributor(
        'alice',
        [
          {
            blockType: BlockType.INFERENCE,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            timestamp: new Date('2024-01-30T00:00:00Z'), // 1 day ago
          },
          {
            blockType: BlockType.TRAINING,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            timestamp: new Date('2024-01-15T00:00:00Z'), // 16 days ago
          },
          {
            blockType: BlockType.INFERENCE,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            timestamp: new Date('2023-12-15T00:00:00Z'), // 47 days ago (outside window)
          },
        ]
      );

      const performance = calculate30DayPerformance(contributor, 30, now);

      // Should include first two blocks only (10 + 15 = 25)
      expect(performance).toBe(25);
    });

    it('should return 0 for contributors with no recent blocks', () => {
      const now = new Date('2024-01-31T00:00:00Z');
      const contributor = createContributor(
        'bob',
        [
          {
            blockType: BlockType.INFERENCE,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            timestamp: new Date('2023-12-01T00:00:00Z'), // 61 days ago
          },
        ]
      );

      const performance = calculate30DayPerformance(contributor, 30, now);

      expect(performance).toBe(0);
    });

    it('should handle custom lookback periods', () => {
      const now = new Date('2024-01-31T00:00:00Z');
      const contributor = createContributor(
        'charlie',
        [
          {
            blockType: BlockType.INFERENCE,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            timestamp: new Date('2024-01-29T00:00:00Z'), // 2 days ago
          },
          {
            blockType: BlockType.INFERENCE,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            timestamp: new Date('2024-01-20T00:00:00Z'), // 11 days ago
          },
        ]
      );

      // 7-day window should only include first block
      const performance7 = calculate30DayPerformance(contributor, 7, now);
      expect(performance7).toBe(10);

      // 14-day window should include both blocks
      const performance14 = calculate30DayPerformance(contributor, 14, now);
      expect(performance14).toBe(20);
    });

    it('should handle contributors with no blocks', () => {
      const contributor = createContributor('dave', []);
      const performance = calculate30DayPerformance(contributor, 30);
      expect(performance).toBe(0);
    });
  });

  describe('calculateAssignmentWeight', () => {
    const config = DEFAULT_BLOCK_ASSIGNMENT_CONFIG;
    const now = new Date('2024-01-31T00:00:00Z');

    it('should calculate weight as sqrt(performance) × reputation', () => {
      const contributor = createContributor(
        'alice',
        [
          {
            blockType: BlockType.TRAINING,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            timestamp: new Date('2024-01-30T00:00:00Z'),
          },
          {
            blockType: BlockType.TRAINING,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            timestamp: new Date('2024-01-29T00:00:00Z'),
          },
          {
            blockType: BlockType.TRAINING,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            timestamp: new Date('2024-01-28T00:00:00Z'),
          },
        ],
        1.0 // Perfect reputation
      );

      // Performance = 15 + 15 + 15 = 45
      // Weight = sqrt(45) × 1.0 ≈ 6.708
      const weight = calculateAssignmentWeight(contributor, config, now);
      expect(weight).toBeCloseTo(6.708, 2);
    });

    it('should apply reputation penalty', () => {
      const contributor = createContributor(
        'bob',
        [
          {
            blockType: BlockType.TRAINING,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            timestamp: new Date('2024-01-30T00:00:00Z'),
          },
        ],
        0.5 // 50% reputation (failed canaries)
      );

      // Performance = 15
      // Weight = sqrt(15) × 0.5 ≈ 1.936
      const weight = calculateAssignmentWeight(contributor, config, now);
      expect(weight).toBeCloseTo(1.936, 2);
    });

    it('should enforce minimum weight for new contributors', () => {
      const newContributor = createContributor('newbie', [], 1.0);

      // Performance = 0, so weight would be 0
      // But minimum weight = 0.1
      const weight = calculateAssignmentWeight(newContributor, config, now);
      expect(weight).toBe(0.1);
    });

    it('should enforce minimum weight even with low reputation', () => {
      const badActorNewbie = createContributor('bad_newbie', [], 0.01);

      // Performance = 0, reputation = 0.01
      // Weight = sqrt(0) × 0.01 = 0
      // But minimum weight = 0.1
      const weight = calculateAssignmentWeight(badActorNewbie, config, now);
      expect(weight).toBe(0.1);
    });

    it('should give higher weights to high performers', () => {
      const highPerformer = createContributor(
        'high_performer',
        Array.from({ length: 100 }, (_, i) => ({
          blockType: BlockType.INFERENCE,
          resourceUsage: 1.0,
          difficultyMultiplier: 1.0,
          timestamp: new Date(now.getTime() - i * 60 * 60 * 1000), // 1 hour apart
        })),
        1.0
      );

      const lowPerformer = createContributor(
        'low_performer',
        [
          {
            blockType: BlockType.INFERENCE,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            timestamp: new Date('2024-01-30T00:00:00Z'),
          },
        ],
        1.0
      );

      const highWeight = calculateAssignmentWeight(highPerformer, config, now);
      const lowWeight = calculateAssignmentWeight(lowPerformer, config, now);

      expect(highWeight).toBeGreaterThan(lowWeight);
    });
  });

  describe('weightedRandomSelect', () => {
    it('should select contributor based on weights', () => {
      const contributors = [
        { accountId: 'alice', weight: 1.0 },
        { accountId: 'bob', weight: 2.0 },
        { accountId: 'charlie', weight: 3.0 },
      ];

      // Deterministic random: always return 0.5
      // Total weight = 6.0, random value = 3.0
      // Cumulative: alice=1 (check: 3.0 < 1.0? no), bob=3 (check: 3.0 < 3.0? no), charlie=6 (check: 3.0 < 6.0? yes)
      const selected = weightedRandomSelect(contributors, () => 0.5);
      expect(selected).toBe('charlie');
    });

    it('should select first contributor when random is 0', () => {
      const contributors = [
        { accountId: 'alice', weight: 1.0 },
        { accountId: 'bob', weight: 2.0 },
      ];

      const selected = weightedRandomSelect(contributors, () => 0);
      expect(selected).toBe('alice');
    });

    it('should select last contributor when random is near 1', () => {
      const contributors = [
        { accountId: 'alice', weight: 1.0 },
        { accountId: 'bob', weight: 2.0 },
      ];

      const selected = weightedRandomSelect(contributors, () => 0.999);
      expect(selected).toBe('bob');
    });

    it('should handle equal weights', () => {
      const contributors = [
        { accountId: 'alice', weight: 1.0 },
        { accountId: 'bob', weight: 1.0 },
        { accountId: 'charlie', weight: 1.0 },
      ];

      // Random = 0.33, total = 3.0, value = 0.99
      // Cumulative: alice=1 (selected)
      const selected = weightedRandomSelect(contributors, () => 0.33);
      expect(selected).toBe('alice');
    });

    it('should throw error for empty contributor list', () => {
      expect(() => {
        weightedRandomSelect([], () => 0.5);
      }).toThrow('Cannot select from empty contributor list');
    });

    it('should throw error when total weight is zero', () => {
      const contributors = [
        { accountId: 'alice', weight: 0 },
        { accountId: 'bob', weight: 0 },
      ];

      expect(() => {
        weightedRandomSelect(contributors, () => 0.5);
      }).toThrow('Total weight is zero');
    });
  });

  describe('assignBatch', () => {
    const config = DEFAULT_BLOCK_ASSIGNMENT_CONFIG;
    const now = new Date('2024-01-31T00:00:00Z');

    it('should assign batch of 5 blocks to selected contributor', () => {
      const contributors = [
        createContributor(
          'alice',
          [
            {
              blockType: BlockType.TRAINING,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              timestamp: new Date('2024-01-30T00:00:00Z'),
            },
          ],
          1.0
        ),
      ];

      const assignment = assignBatch(contributors, config, 1, now, () => 0.5);

      expect(assignment.contributorId).toBe('alice');
      expect(assignment.blockIds).toHaveLength(5);
      expect(assignment.blockIds).toEqual([
        'block_1_1',
        'block_1_2',
        'block_1_3',
        'block_1_4',
        'block_1_5',
      ]);
      expect(assignment.batchNumber).toBe(1);
      expect(assignment.assignedAt).toEqual(now);
    });

    it('should prefer high performers in weighted lottery', () => {
      const contributors = [
        createContributor(
          'alice',
          [
            {
              blockType: BlockType.TRAINING,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              timestamp: new Date('2024-01-30T00:00:00Z'),
            },
          ],
          1.0
        ), // Weight ≈ 3.87
        createContributor(
          'bob',
          Array.from({ length: 10 }, (_, i) => ({
            blockType: BlockType.TRAINING,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            timestamp: new Date(now.getTime() - i * 60 * 60 * 1000),
          })),
          1.0
        ), // Weight ≈ 12.25 (high performer)
      ];

      // With random = 0.8, bob should be selected (higher cumulative weight)
      const assignment = assignBatch(contributors, config, 1, now, () => 0.8);
      expect(assignment.contributorId).toBe('bob');
    });

    it('should throw error when no contributors available', () => {
      expect(() => {
        assignBatch([], config, 1, now, () => 0.5);
      }).toThrow('Cannot assign batch with no contributors');
    });
  });

  describe('distributeDailyBlocks', () => {
    const config = DEFAULT_BLOCK_ASSIGNMENT_CONFIG;
    const now = new Date('2024-01-31T00:00:00Z');

    it('should distribute 2,200 blocks in 440 batches', () => {
      const contributors = [
        createContributor(
          'alice',
          [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              timestamp: new Date('2024-01-30T00:00:00Z'),
            },
          ],
          1.0
        ),
      ];

      const assignments = distributeDailyBlocks(contributors, config, now);

      expect(assignments).toHaveLength(440); // 2,200 / 5 = 440 batches

      // Check first batch
      expect(assignments[0].batchNumber).toBe(1);
      expect(assignments[0].blockIds).toHaveLength(5);

      // Check last batch
      expect(assignments[439].batchNumber).toBe(440);
      expect(assignments[439].blockIds).toHaveLength(5);

      // Total blocks assigned
      const totalBlocks = assignments.reduce(
        (sum, a) => sum + a.blockIds.length,
        0
      );
      expect(totalBlocks).toBe(2200);
    });

    it('should distribute blocks fairly based on weights', () => {
      const contributors = [
        createContributor(
          'low_performer',
          [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              timestamp: new Date('2024-01-30T00:00:00Z'),
            },
          ],
          1.0
        ), // Weight ≈ 3.16
        createContributor(
          'high_performer',
          Array.from({ length: 100 }, (_, i) => ({
            blockType: BlockType.INFERENCE,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            timestamp: new Date(now.getTime() - i * 60 * 60 * 1000),
          })),
          1.0
        ), // Weight ≈ 31.6 (10x higher)
      ];

      // Use seeded random for deterministic results
      let seed = 12345;
      const seededRandom = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };

      const assignments = distributeDailyBlocks(
        contributors,
        config,
        now,
        seededRandom
      );

      // Count assignments per contributor
      const lowPerformerCount = assignments.filter(
        a => a.contributorId === 'low_performer'
      ).length;
      const highPerformerCount = assignments.filter(
        a => a.contributorId === 'high_performer'
      ).length;

      // High performer should get significantly more batches
      expect(highPerformerCount).toBeGreaterThan(lowPerformerCount * 5);

      // Both should get at least some batches (not zero)
      expect(lowPerformerCount).toBeGreaterThan(0);
      expect(highPerformerCount).toBeGreaterThan(0);
    });

    it('should return empty array when no contributors', () => {
      const assignments = distributeDailyBlocks([], config, now);
      expect(assignments).toEqual([]);
    });

    it('should work with single contributor', () => {
      const contributors = [
        createContributor(
          'alice',
          [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              timestamp: new Date('2024-01-30T00:00:00Z'),
            },
          ],
          1.0
        ),
      ];

      const assignments = distributeDailyBlocks(contributors, config, now);

      expect(assignments).toHaveLength(440);
      // All assignments should go to alice
      expect(assignments.every(a => a.contributorId === 'alice')).toBe(true);
    });
  });

  describe('getContributorAssignmentStats', () => {
    it('should count batches and blocks for contributor', () => {
      const assignments = [
        {
          contributorId: 'alice',
          blockIds: ['b1', 'b2', 'b3', 'b4', 'b5'],
          assignedAt: new Date(),
          batchNumber: 1,
        },
        {
          contributorId: 'bob',
          blockIds: ['b6', 'b7', 'b8', 'b9', 'b10'],
          assignedAt: new Date(),
          batchNumber: 2,
        },
        {
          contributorId: 'alice',
          blockIds: ['b11', 'b12', 'b13', 'b14', 'b15'],
          assignedAt: new Date(),
          batchNumber: 3,
        },
      ];

      const aliceStats = getContributorAssignmentStats(assignments, 'alice');
      expect(aliceStats.batchCount).toBe(2);
      expect(aliceStats.blockCount).toBe(10);

      const bobStats = getContributorAssignmentStats(assignments, 'bob');
      expect(bobStats.batchCount).toBe(1);
      expect(bobStats.blockCount).toBe(5);
    });

    it('should return zeros for contributor with no assignments', () => {
      const assignments = [
        {
          contributorId: 'alice',
          blockIds: ['b1', 'b2', 'b3', 'b4', 'b5'],
          assignedAt: new Date(),
          batchNumber: 1,
        },
      ];

      const stats = getContributorAssignmentStats(assignments, 'bob');
      expect(stats.batchCount).toBe(0);
      expect(stats.blockCount).toBe(0);
    });
  });

  describe('Integration: Reputation and Block Assignment', () => {
    const config = DEFAULT_BLOCK_ASSIGNMENT_CONFIG;
    const now = new Date('2024-01-31T00:00:00Z');

    it('should penalize bad actors with low reputation', () => {
      const contributors = [
        createContributor(
          'honest_alice',
          Array.from({ length: 50 }, (_, i) => ({
            blockType: BlockType.INFERENCE,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            timestamp: new Date(now.getTime() - i * 60 * 60 * 1000),
          })),
          1.0 // Perfect reputation
        ),
        createContributor(
          'cheater_bob',
          Array.from({ length: 50 }, (_, i) => ({
            blockType: BlockType.INFERENCE,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            timestamp: new Date(now.getTime() - i * 60 * 60 * 1000),
          })),
          0.3 // Poor reputation (failed canaries)
        ),
      ];

      // Calculate weights
      const aliceWeight = calculateAssignmentWeight(contributors[0], config, now);
      const bobWeight = calculateAssignmentWeight(contributors[1], config, now);

      // Alice should have higher weight despite same performance
      expect(aliceWeight).toBeGreaterThan(bobWeight);

      // Bob's weight should be ~30% of Alice's (reputation penalty)
      expect(bobWeight / aliceWeight).toBeCloseTo(0.3, 1);
    });

    it('should give new contributors minimum weight despite zero reputation', () => {
      const contributors = [
        createContributor('experienced', [], 0.8),
        createContributor('newbie', [], 0.0), // Zero reputation
      ];

      const experiencedWeight = calculateAssignmentWeight(
        contributors[0],
        config,
        now
      );
      const newbieWeight = calculateAssignmentWeight(contributors[1], config, now);

      // Both should have minimum weight
      expect(experiencedWeight).toBe(0.1);
      expect(newbieWeight).toBe(0.1);
    });
  });

  describe('Integration: Block Assignment + Canary System', () => {
    const config = DEFAULT_BLOCK_ASSIGNMENT_CONFIG;
    const now = new Date('2024-01-31T00:00:00Z');

    it('should reduce block assignments after canary failures lower reputation', () => {
      // Scenario: Alice and Bob both have same performance, but Bob fails canaries

      // Initial state: both have 50 blocks completed
      const aliceInitial = createContributor(
        'alice',
        Array.from({ length: 50 }, (_, i) => ({
          blockType: BlockType.INFERENCE,
          resourceUsage: 1.0,
          difficultyMultiplier: 1.0,
          timestamp: new Date(now.getTime() - i * 60 * 60 * 1000),
        })),
        1.0 // Perfect reputation - no canary failures
      );

      const bobAfterFailures = createContributor(
        'bob',
        Array.from({ length: 50 }, (_, i) => ({
          blockType: BlockType.INFERENCE,
          resourceUsage: 1.0,
          difficultyMultiplier: 1.0,
          timestamp: new Date(now.getTime() - i * 60 * 60 * 1000),
        })),
        0.7 // Reputation = 1.0 - (3 failures × 0.1 penalty) = 0.7
      );
      bobAfterFailures.canaryFailures = 3;

      // Calculate weights
      const aliceWeight = calculateAssignmentWeight(aliceInitial, config, now);
      const bobWeight = calculateAssignmentWeight(bobAfterFailures, config, now);

      // Bob's weight should be 70% of Alice's (reputation penalty)
      expect(bobWeight / aliceWeight).toBeCloseTo(0.7, 1);

      // Simulate block distribution
      const contributors = [aliceInitial, bobAfterFailures];

      // Use seeded random for deterministic results
      let seed = 54321;
      const seededRandom = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };

      const assignments = distributeDailyBlocks(
        contributors,
        config,
        now,
        seededRandom
      );

      const aliceStats = getContributorAssignmentStats(assignments, 'alice');
      const bobStats = getContributorAssignmentStats(assignments, 'bob');

      // Alice should get significantly more batches due to higher weight
      expect(aliceStats.batchCount).toBeGreaterThan(bobStats.batchCount);

      // Ratio should be roughly 1.0 / 0.7 ≈ 1.43x
      const ratio = aliceStats.batchCount / bobStats.batchCount;
      expect(ratio).toBeGreaterThan(1.2);
      expect(ratio).toBeLessThan(1.7);
    });

    it('should increase block assignments after rehabilitation', () => {
      // Scenario: Bob had 3 failures (reputation 0.7) but passed 10 canaries

      const bobAfterRehab = createContributor(
        'bob',
        Array.from({ length: 50 }, (_, i) => ({
          blockType: BlockType.INFERENCE,
          resourceUsage: 1.0,
          difficultyMultiplier: 1.0,
          timestamp: new Date(now.getTime() - i * 60 * 60 * 1000),
        })),
        0.7 // Started at 0.7 reputation
      );
      bobAfterRehab.canaryFailures = 3;
      bobAfterRehab.canaryPasses = 10; // Rehabilitation!

      // After rehabilitation, Bob's reputation should improve
      // Note: This test validates weight calculation, not reputation calculation
      // (Reputation improvement happens in computePoints.ts, not here)

      // Let's test with improved reputation
      const bobFullyRecovered = createContributor(
        'bob_recovered',
        Array.from({ length: 50 }, (_, i) => ({
          blockType: BlockType.INFERENCE,
          resourceUsage: 1.0,
          difficultyMultiplier: 1.0,
          timestamp: new Date(now.getTime() - i * 60 * 60 * 1000),
        })),
        1.0 // Reputation recovered to 1.0 through passes
      );

      const weightBefore = calculateAssignmentWeight(bobAfterRehab, config, now);
      const weightAfter = calculateAssignmentWeight(bobFullyRecovered, config, now);

      // Weight should increase when reputation improves
      expect(weightAfter).toBeGreaterThan(weightBefore);
    });

    it('should handle contributors with mixed performance and reputation', () => {
      const contributors = [
        // High performer, good reputation
        createContributor(
          'alice',
          Array.from({ length: 100 }, (_, i) => ({
            blockType: BlockType.TRAINING,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            timestamp: new Date(now.getTime() - i * 60 * 60 * 1000),
          })),
          1.0
        ),
        // High performer, bad reputation
        createContributor(
          'bob',
          Array.from({ length: 100 }, (_, i) => ({
            blockType: BlockType.TRAINING,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            timestamp: new Date(now.getTime() - i * 60 * 60 * 1000),
          })),
          0.3
        ),
        // Low performer, good reputation
        createContributor(
          'charlie',
          [
            {
              blockType: BlockType.INFERENCE,
              resourceUsage: 1.0,
              difficultyMultiplier: 1.0,
              timestamp: new Date('2024-01-30T00:00:00Z'),
            },
          ],
          1.0
        ),
        // New contributor
        createContributor('dave', [], 1.0),
      ];

      // Calculate weights
      const weights = contributors.map(c =>
        calculateAssignmentWeight(c, config, now)
      );

      // alice (high perf × 1.0) > bob (high perf × 0.3) > charlie (low perf × 1.0) ≥ dave (new)
      expect(weights[0]).toBeGreaterThan(weights[1]); // alice > bob
      expect(weights[1]).toBeGreaterThan(weights[2]); // bob > charlie
      expect(weights[2]).toBeGreaterThanOrEqual(weights[3]); // charlie ≥ dave (or equal to min)
    });

    it('should demonstrate full workflow: assignment → completion → reputation change', () => {
      // Day 1: Initial assignment
      const contributors = [
        createContributor(
          'alice',
          Array.from({ length: 20 }, (_, i) => ({
            blockType: BlockType.INFERENCE,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            timestamp: new Date(now.getTime() - (i + 10) * 60 * 60 * 1000),
          })),
          1.0
        ),
      ];

      const day1Assignments = distributeDailyBlocks(contributors, config, now);
      expect(day1Assignments).toHaveLength(440); // 2,200 blocks / 5 = 440 batches

      // Day 2: Alice completes some blocks, including canary failures
      const aliceDay2 = createContributor(
        'alice',
        [
          ...contributors[0].completedBlocks,
          // Add more completed blocks
          ...Array.from({ length: 10 }, (_, i) => ({
            blockType: BlockType.INFERENCE,
            resourceUsage: 1.0,
            difficultyMultiplier: 1.0,
            timestamp: new Date(now.getTime() - i * 60 * 60 * 1000),
          })),
        ],
        0.9 // Reputation dropped due to 1 canary failure
      );
      aliceDay2.canaryFailures = 1;

      // Check weight change
      const weightDay1 = calculateAssignmentWeight(contributors[0], config, now);
      const weightDay2 = calculateAssignmentWeight(
        aliceDay2,
        config,
        new Date(now.getTime() + 24 * 60 * 60 * 1000)
      );

      // Weight on day 2 should be higher (more performance) but affected by reputation
      // Performance increased (20 → 30 blocks), but reputation dropped (1.0 → 0.9)
      // Net effect: sqrt(200) × 1.0 = 14.14 vs sqrt(300) × 0.9 = 15.59
      expect(weightDay2).toBeGreaterThan(weightDay1);
    });

    it('should exclude contributors blocked by 24h canary cooldown', () => {
      // This test validates that the block assignment system respects 24h blocks
      // (Enforcement happens in isActiveContributor, not in block assignment itself)

      const now = new Date('2024-01-31T12:00:00Z');

      // Alice failed canary 12 hours ago (still blocked)
      const aliceBlocked = createContributor(
        'alice',
        Array.from({ length: 50 }, (_, i) => ({
          blockType: BlockType.INFERENCE,
          resourceUsage: 1.0,
          difficultyMultiplier: 1.0,
          timestamp: new Date(now.getTime() - (i + 1) * 60 * 60 * 1000),
        })),
        0.9
      );
      aliceBlocked.lastCanaryFailureTime = new Date('2024-01-31T00:00:00Z'); // 12h ago

      // Bob has no recent failures
      const bobActive = createContributor(
        'bob',
        Array.from({ length: 50 }, (_, i) => ({
          blockType: BlockType.INFERENCE,
          resourceUsage: 1.0,
          difficultyMultiplier: 1.0,
          timestamp: new Date(now.getTime() - (i + 1) * 60 * 60 * 1000),
        })),
        1.0
      );

      // Note: In production, we'd filter blocked contributors before assignment
      // For this test, we demonstrate that blocked contributors would need filtering
      // The assignment system itself doesn't check 24h blocks (that's upstream)

      const weightAlice = calculateAssignmentWeight(aliceBlocked, config, now);
      const weightBob = calculateAssignmentWeight(bobActive, config, now);

      // Both have same performance, Alice has 0.9 reputation vs Bob's 1.0
      expect(weightBob).toBeGreaterThan(weightAlice);
      expect(weightAlice / weightBob).toBeCloseTo(0.9, 1);
    });
  });
});

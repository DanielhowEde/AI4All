/**
 * AI4All Block Assignment System
 *
 * Distributes blocks to contributors using weighted lottery based on:
 * - Past 30-day performance (compute points earned)
 * - Current reputation multiplier
 * - Minimum weight for new contributors
 */

import { Contributor, BlockAssignmentConfig, BlockAssignment } from './types';
import { calculateTotalComputePoints } from './computePoints';

/**
 * Calculate 30-day performance for a contributor
 *
 * Sums up compute points from blocks completed in the last N days.
 * Used to determine assignment weight.
 *
 * @param contributor Contributor to analyze
 * @param lookbackDays Number of days to look back (default: 30)
 * @param currentTime Current timestamp (for deterministic testing)
 * @returns Total compute points in the lookback period
 */
export function calculate30DayPerformance(
  contributor: Contributor,
  lookbackDays: number = 30,
  currentTime: Date = new Date()
): number {
  const cutoffTime = new Date(currentTime.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  // Filter blocks within the lookback window
  const recentBlocks = contributor.completedBlocks.filter(
    block => block.timestamp >= cutoffTime && block.timestamp <= currentTime
  );

  // Create temporary contributor object with only recent blocks
  const recentContributor = {
    ...contributor,
    completedBlocks: recentBlocks,
  };

  // Calculate total compute points for recent blocks
  return calculateTotalComputePoints(recentContributor);
}

/**
 * Calculate assignment weight for a contributor
 *
 * Formula: weight = sqrt(30_day_compute_points) × reputation_multiplier
 *
 * Key properties:
 * - Sqrt provides diminishing returns (Sybil resistance)
 * - Reputation multiplier penalizes bad actors
 * - Minimum weight ensures new contributors get some chance
 *
 * @param contributor Contributor to calculate weight for
 * @param config Block assignment configuration
 * @param currentTime Current timestamp (for deterministic testing)
 * @returns Assignment weight (>= config.newContributorMinWeight)
 */
export function calculateAssignmentWeight(
  contributor: Contributor,
  config: BlockAssignmentConfig,
  currentTime: Date = new Date()
): number {
  // Get 30-day performance
  const performance = calculate30DayPerformance(
    contributor,
    config.performanceLookbackDays,
    currentTime
  );

  // Apply sqrt for diminishing returns (Sybil resistance)
  const sqrtPerformance = Math.sqrt(performance);

  // Multiply by reputation (penalizes bad actors)
  const weight = sqrtPerformance * contributor.reputationMultiplier;

  // Ensure minimum weight for new contributors
  return Math.max(weight, config.newContributorMinWeight);
}

/**
 * Perform weighted random selection
 *
 * Selects one contributor from the pool based on their weights.
 * Higher weight = higher probability of selection.
 *
 * Uses a simple cumulative weight algorithm:
 * 1. Generate random number between 0 and total weight
 * 2. Walk through contributors, summing weights
 * 3. Return the contributor where cumulative weight exceeds random number
 *
 * @param contributors Contributors with their weights
 * @param random Random number generator (0-1)
 * @returns Selected contributor's accountId
 */
export function weightedRandomSelect(
  contributors: Array<{ accountId: string; weight: number }>,
  random: () => number = Math.random
): string {
  if (contributors.length === 0) {
    throw new Error('Cannot select from empty contributor list');
  }

  // Calculate total weight
  const totalWeight = contributors.reduce((sum, c) => sum + c.weight, 0);

  if (totalWeight === 0) {
    throw new Error('Total weight is zero - all contributors have 0 weight');
  }

  // Generate random number in [0, totalWeight)
  const randomValue = random() * totalWeight;

  // Walk through contributors, accumulating weight
  let cumulativeWeight = 0;
  for (const contributor of contributors) {
    cumulativeWeight += contributor.weight;
    if (randomValue < cumulativeWeight) {
      return contributor.accountId;
    }
  }

  // Fallback (should never reach here due to floating point)
  return contributors[contributors.length - 1].accountId;
}

/**
 * Assign a batch of blocks to contributors using weighted lottery
 *
 * Each batch is independently assigned based on contributor weights.
 * This is a "pure weighted lottery" where every batch has the same
 * probability distribution.
 *
 * @param contributors All eligible contributors
 * @param config Block assignment configuration
 * @param batchNumber Which batch this is (for tracking)
 * @param currentTime Current timestamp (for deterministic testing)
 * @param random Random number generator (for deterministic testing)
 * @returns BlockAssignment for the selected contributor
 */
export function assignBatch(
  contributors: Contributor[],
  config: BlockAssignmentConfig,
  batchNumber: number,
  currentTime: Date = new Date(),
  random: () => number = Math.random
): BlockAssignment {
  if (contributors.length === 0) {
    throw new Error('Cannot assign batch with no contributors');
  }

  // Calculate weights for all contributors
  const contributorWeights = contributors.map(c => ({
    accountId: c.accountId,
    weight: calculateAssignmentWeight(c, config, currentTime),
  }));

  // Select contributor using weighted lottery
  const selectedAccountId = weightedRandomSelect(contributorWeights, random);

  // Generate block IDs for the batch
  const blockIds: string[] = [];
  for (let i = 0; i < config.batchSize; i++) {
    const blockId = `block_${batchNumber}_${i + 1}`;
    blockIds.push(blockId);
  }

  return {
    contributorId: selectedAccountId,
    blockIds,
    assignedAt: currentTime,
    batchNumber,
  };
}

/**
 * Distribute daily block quota across all contributors
 *
 * Distributes dailyBlockQuota blocks in batches of batchSize to contributors
 * using weighted lottery. Each batch is independently assigned.
 *
 * Formula: number_of_batches = dailyBlockQuota / batchSize
 * Example: 2,200 blocks / 5 per batch = 440 batches
 *
 * @param contributors All eligible contributors
 * @param config Block assignment configuration
 * @param currentTime Current timestamp (for deterministic testing)
 * @param random Random number generator (for deterministic testing)
 * @returns Array of BlockAssignments (one per batch)
 */
export function distributeDailyBlocks(
  contributors: Contributor[],
  config: BlockAssignmentConfig,
  currentTime: Date = new Date(),
  random: () => number = Math.random
): BlockAssignment[] {
  if (contributors.length === 0) {
    return [];
  }

  // Calculate number of batches
  const numberOfBatches = Math.floor(config.dailyBlockQuota / config.batchSize);

  // Assign each batch
  const assignments: BlockAssignment[] = [];
  for (let batchNum = 1; batchNum <= numberOfBatches; batchNum++) {
    const assignment = assignBatch(
      contributors,
      config,
      batchNum,
      currentTime,
      random
    );
    assignments.push(assignment);
  }

  return assignments;
}

/**
 * Get assignment statistics for a contributor
 *
 * Analyzes how many batches a contributor received from a set of assignments.
 * Useful for testing and monitoring fairness.
 *
 * @param assignments Array of block assignments
 * @param accountId Contributor to analyze
 * @returns Object with batch count and total block count
 */
export function getContributorAssignmentStats(
  assignments: BlockAssignment[],
  accountId: string
): { batchCount: number; blockCount: number } {
  const contributorAssignments = assignments.filter(
    a => a.contributorId === accountId
  );

  const batchCount = contributorAssignments.length;
  const blockCount = contributorAssignments.reduce(
    (sum, a) => sum + a.blockIds.length,
    0
  );

  return { batchCount, blockCount };
}

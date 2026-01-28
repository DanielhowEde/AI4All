/**
 * AI4All Reward Distribution System - Compute Points Calculation
 * v1.0
 */

import { CompletedBlock, Contributor, BLOCK_TYPE_POINTS, RewardConfig } from './types';

/**
 * Calculate compute points for a single block
 *
 * Formula: base_points × resource_usage × difficulty × validation_success × canary_check
 *
 * @param block The completed block
 * @returns Compute points earned (>= 0)
 */
export function calculateBlockPoints(block: CompletedBlock): number {
  const basePoints = BLOCK_TYPE_POINTS[block.blockType];
  const validationFactor = block.validationPassed ? 1.0 : 0.0; // Failed blocks = 0 points

  // Resource usage is normalized 0-1
  if (block.resourceUsage < 0 || block.resourceUsage > 1) {
    throw new Error(`Invalid resourceUsage: ${block.resourceUsage}. Must be between 0 and 1.`);
  }

  // Difficulty must be >= 1.0
  if (block.difficultyMultiplier < 1.0) {
    throw new Error(`Invalid difficultyMultiplier: ${block.difficultyMultiplier}. Must be >= 1.0.`);
  }

  // Canary block check: if this is a canary and answered incorrectly, 0 points
  if (block.isCanary === true) {
    if (block.canaryAnswerCorrect === undefined) {
      throw new Error('Canary block must have canaryAnswerCorrect field set');
    }
    if (!block.canaryAnswerCorrect) {
      return 0; // Failed canary = 0 points (anti-gaming)
    }
  }

  return basePoints * block.resourceUsage * block.difficultyMultiplier * validationFactor;
}

/**
 * Calculate total compute points for a contributor
 *
 * @param contributor The contributor with completed blocks
 * @returns Total raw compute points (before reputation multiplier)
 */
export function calculateTotalComputePoints(contributor: Contributor): number {
  return contributor.completedBlocks.reduce((total, block) => {
    return total + calculateBlockPoints(block);
  }, 0);
}

/**
 * Calculate reward points for a contributor (excludes canary blocks)
 *
 * Canary blocks are validation/test blocks and should not count toward rewards.
 * They exist solely to detect cheaters, not to earn tokens.
 *
 * This function filters out ALL canary blocks (both passed and failed) and
 * only counts real work blocks for reward calculation.
 *
 * IMPORTANT: Uses rolling time window (default 30 days) to prevent "rich get richer forever".
 * This aligns with block assignment's 30-day performance window.
 *
 * @param contributor The contributor with completed blocks
 * @param lookbackDays Number of days to look back (default: 30, undefined = all-time for backward compat)
 * @param currentTime Current timestamp (for deterministic testing, default: now)
 * @returns Total reward points (excluding canaries, before reputation multiplier)
 */
export function calculateRewardPoints(
  contributor: Contributor,
  lookbackDays?: number,
  currentTime: Date = new Date()
): number {
  let blocksToConsider = contributor.completedBlocks;

  // If lookback window is specified, filter by timestamp
  if (lookbackDays !== undefined) {
    const cutoffTime = new Date(currentTime.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
    blocksToConsider = blocksToConsider.filter(
      block => block.timestamp >= cutoffTime && block.timestamp <= currentTime
    );
  }

  // Exclude all canaries and calculate points
  return blocksToConsider
    .filter(block => !block.isCanary) // Exclude all canaries
    .reduce((total, block) => {
      return total + calculateBlockPoints(block);
    }, 0);
}

/**
 * Calculate effective compute points (after reputation penalty)
 *
 * @param contributor The contributor
 * @returns Effective compute points (can be reduced by reputation)
 */
export function calculateEffectiveComputePoints(contributor: Contributor): number {
  const rawPoints = calculateTotalComputePoints(contributor);
  return rawPoints * contributor.reputationMultiplier;
}

/**
 * Calculate reputation adjustment based on canary failures
 *
 * Reputation starts at 1.0 and is reduced for each failed canary.
 * No permanent bans - contributors can rehabilitate by passing canaries.
 *
 * @param baseReputation Starting reputation (before canary penalties)
 * @param canaryFailures Number of failed canary blocks
 * @param config Reward configuration
 * @returns Adjusted reputation (0-1)
 */
export function calculateReputationWithCanaryPenalty(
  baseReputation: number,
  canaryFailures: number,
  config: RewardConfig
): number {
  if (baseReputation < 0 || baseReputation > 1) {
    throw new Error(`Invalid baseReputation: ${baseReputation}. Must be between 0 and 1.`);
  }

  // Apply penalty for each failure
  const penalty = canaryFailures * config.canaryFailurePenalty;
  const adjustedReputation = Math.max(0, baseReputation - penalty);

  return adjustedReputation;
}

/**
 * Count failed canary blocks for a contributor
 *
 * @param contributor The contributor
 * @returns Number of failed canary blocks
 */
export function countFailedCanaries(contributor: Contributor): number {
  return contributor.completedBlocks.filter(block => {
    return block.isCanary === true && block.canaryAnswerCorrect === false;
  }).length;
}

/**
 * Count passed canary blocks for a contributor
 *
 * @param contributor The contributor
 * @returns Number of passed canary blocks
 */
export function countPassedCanaries(contributor: Contributor): number {
  return contributor.completedBlocks.filter(block => {
    return block.isCanary === true && block.canaryAnswerCorrect === true;
  }).length;
}

/**
 * Calculate dynamic canary rate for a contributor based on their history
 *
 * Contributors who fail canaries get higher canary rates (more scrutiny).
 * Contributors who pass canaries get lower canary rates (rehabilitation).
 *
 * Formula: base + (failures × increase) - (passes × decrease)
 * Clamped between min and max.
 *
 * @param contributor The contributor
 * @param config Reward configuration
 * @returns Personalized canary percentage (0-1)
 */
export function calculateDynamicCanaryRate(
  contributor: Contributor,
  config: RewardConfig
): number {
  // Use the canaryFailures and canaryPasses fields directly for efficiency
  const failures = contributor.canaryFailures;
  const passes = contributor.canaryPasses;

  // Start with base rate
  let canaryRate = config.baseCanaryPercentage;

  // Increase for failures (escalating scrutiny)
  canaryRate += failures * config.canaryIncreasePerFailure;

  // Decrease for passes (rehabilitation)
  canaryRate -= passes * config.canaryDecreasePerPass;

  // Clamp between min and max
  canaryRate = Math.max(config.minCanaryPercentage, canaryRate);
  canaryRate = Math.min(config.maxCanaryPercentage, canaryRate);

  return canaryRate;
}

/**
 * Get the timestamp of the most recent canary failure
 *
 * @param contributor The contributor
 * @returns Date of most recent failure, or undefined if no failures
 */
export function getMostRecentCanaryFailureTime(contributor: Contributor): Date | undefined {
  const failedCanaries = contributor.completedBlocks.filter(block => {
    return block.isCanary === true && block.canaryAnswerCorrect === false;
  });

  if (failedCanaries.length === 0) {
    return undefined;
  }

  // Find the most recent failure
  const mostRecent = failedCanaries.reduce((latest, block) => {
    return block.timestamp > latest.timestamp ? block : latest;
  });

  return mostRecent.timestamp;
}

/**
 * Check if a contributor is currently blocked from rewards due to recent canary failure
 *
 * Contributors who fail a canary are blocked from receiving rewards for a configured
 * duration (default 24 hours) as an immediate penalty.
 *
 * @param contributor The contributor
 * @param config Reward configuration
 * @param currentTime Current timestamp (defaults to now, can be overridden for testing)
 * @returns true if contributor is currently blocked
 */
export function isBlockedByRecentCanaryFailure(
  contributor: Contributor,
  config: RewardConfig,
  currentTime: Date = new Date()
): boolean {
  // Use lastCanaryFailureTime if available, otherwise compute from blocks
  const lastFailureTime = contributor.lastCanaryFailureTime
    ?? getMostRecentCanaryFailureTime(contributor);

  if (!lastFailureTime) {
    return false; // No failures, not blocked
  }

  const timeSinceFailure = currentTime.getTime() - lastFailureTime.getTime();
  return timeSinceFailure < config.canaryBlockDurationMs;
}

/**
 * Determine if a contributor is active for the day
 *
 * Active means:
 * - Not blocked by recent canary failure (24h cooldown)
 * - Completed >= minBlocksForActive verified blocks
 * - Passes minimum reliability threshold
 * - Has at least one validated block
 *
 * Note: No permanent bans. Contributors can rehabilitate by passing canaries.
 *
 * @param contributor The contributor
 * @param config Reward configuration
 * @param currentTime Current timestamp (defaults to now, can be overridden for testing)
 * @returns true if contributor is active
 */
export function isActiveContributor(
  contributor: Contributor,
  config: RewardConfig,
  currentTime?: Date
): boolean {
  // FIRST: Check if blocked by recent canary failure (24h cooldown)
  if (isBlockedByRecentCanaryFailure(contributor, config, currentTime)) {
    return false;
  }

  // Apply canary penalty to reputation
  const effectiveReputation = calculateReputationWithCanaryPenalty(
    contributor.reputationMultiplier,
    contributor.canaryFailures,
    config
  );

  // Check reputation threshold
  if (effectiveReputation < config.minReliability) {
    return false;
  }

  // Count validated blocks
  const validatedBlocks = contributor.completedBlocks.filter(b => b.validationPassed);

  if (validatedBlocks.length < config.minBlocksForActive) {
    return false;
  }

  // Must have earned at least some points
  const effectivePoints = calculateEffectiveComputePoints(contributor);
  return effectivePoints > 0;
}

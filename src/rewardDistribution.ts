/**
 * AI4All Reward Distribution System - Daily Reward Calculation
 * v1.0
 */

import { Contributor, RewardConfig, ContributorReward, RewardDistribution } from './types';
import { isActiveContributor, calculateRewardPoints } from './computePoints';

/**
 * Filter contributors to get only active ones for a given day
 *
 * Active contributors are those who pass all eligibility checks:
 * - Not blocked by recent canary failure (24h cooldown)
 * - Meet minimum block requirements
 * - Pass reputation threshold
 * - Have earned points
 *
 * @param contributors All contributors
 * @param config Reward configuration
 * @param currentTime Current timestamp (for deterministic testing)
 * @returns Array of active contributors
 */
export function getActiveContributors(
  contributors: Contributor[],
  config: RewardConfig,
  currentTime?: Date
): Contributor[] {
  return contributors.filter(contributor =>
    isActiveContributor(contributor, config, currentTime)
  );
}

/**
 * Calculate base pool amount from daily emissions
 *
 * Base pool is a percentage of daily emissions (default 30%)
 * distributed equally among all active contributors.
 *
 * @param config Reward configuration
 * @returns Base pool token amount
 */
export function calculateBasePoolAmount(config: RewardConfig): number {
  return config.dailyEmissions * config.basePoolPercentage;
}

/**
 * Calculate performance pool amount from daily emissions
 *
 * Performance pool is a percentage of daily emissions (default 70%)
 * distributed based on merit (compute points with sqrt weighting).
 *
 * @param config Reward configuration
 * @returns Performance pool token amount
 */
export function calculatePerformancePoolAmount(config: RewardConfig): number {
  return config.dailyEmissions * config.performancePoolPercentage;
}

/**
 * Distribute base pool equally among active contributors
 *
 * Each active contributor receives an equal share of the base pool,
 * regardless of how much work they did. This ensures small contributors
 * always get meaningful rewards (fairness floor).
 *
 * Formula: base_pool / active_contributor_count
 *
 * @param activeContributors Array of active contributors
 * @param basePoolAmount Total base pool tokens to distribute
 * @returns Map of accountId → base pool reward
 */
export function distributeBasePool(
  activeContributors: Contributor[],
  basePoolAmount: number
): Map<string, number> {
  const rewards = new Map<string, number>();

  // Edge case: No active contributors
  if (activeContributors.length === 0) {
    return rewards;
  }

  // Calculate equal share for each contributor
  const rewardPerContributor = basePoolAmount / activeContributors.length;

  // Distribute equally
  for (const contributor of activeContributors) {
    rewards.set(contributor.accountId, rewardPerContributor);
  }

  return rewards;
}

/**
 * Calculate base pool rewards and create initial contributor reward records
 *
 * This is the first step in daily reward distribution. It creates
 * ContributorReward objects with base pool allocations. Performance
 * and luck pools will be added in subsequent steps.
 *
 * @param contributors All contributors
 * @param config Reward configuration
 * @param currentTime Current timestamp (for deterministic testing)
 * @returns Array of ContributorReward with base pool allocated
 */
export function calculateBasePoolRewards(
  contributors: Contributor[],
  config: RewardConfig,
  currentTime?: Date
): ContributorReward[] {
  // Get active contributors
  const activeContributors = getActiveContributors(contributors, config, currentTime);

  // Calculate base pool amount
  const basePoolAmount = calculateBasePoolAmount(config);

  // Distribute base pool
  const basePoolRewards = distributeBasePool(activeContributors, basePoolAmount);

  // Create ContributorReward records
  const rewards: ContributorReward[] = [];

  for (const contributor of activeContributors) {
    const baseReward = basePoolRewards.get(contributor.accountId) || 0;

    rewards.push({
      accountId: contributor.accountId,
      basePoolReward: baseReward,
      performancePoolReward: 0, // Will be calculated in next milestone
      luckPoolReward: 0, // Will be calculated in next milestone
      totalReward: baseReward,
      reason: `Base pool: ${baseReward.toFixed(2)} tokens (equal share among ${activeContributors.length} active contributors)`,
    });
  }

  return rewards;
}

/**
 * Calculate performance weight for a contributor using sqrt diminishing returns
 *
 * The sqrt transformation provides diminishing returns per unit of work,
 * preventing monopolization by high performers.
 *
 * IMPORTANT:
 * - Uses 30-day rolling window to prevent "rich get richer forever"
 * - Excludes canary blocks (validation/test blocks, not productive work)
 * - Aligns with block assignment's 30-day performance window
 *
 * Formula: weight = sqrt(reward_points_last_N_days) where reward_points excludes canaries
 *
 * Example:
 * - 100 points → sqrt(100) = 10 weight
 * - 400 points → sqrt(400) = 20 weight (4x points = 2x weight)
 * - 900 points → sqrt(900) = 30 weight (9x points = 3x weight)
 *
 * @param contributor Contributor to calculate weight for
 * @param config Reward configuration (includes lookback window)
 * @param currentTime Current timestamp (for deterministic testing)
 * @returns Performance weight (sqrt of reward points, excluding canaries)
 */
export function calculatePerformanceWeight(
  contributor: Contributor,
  config: RewardConfig,
  currentTime: Date = new Date()
): number {
  const rewardPoints = calculateRewardPoints(
    contributor,
    config.performanceLookbackDays,
    currentTime
  );
  return Math.sqrt(rewardPoints);
}

/**
 * Distribute performance pool based on sqrt-weighted merit
 *
 * Each contributor receives a share of the performance pool proportional
 * to their sqrt(compute_points) relative to the sum of all sqrt weights.
 *
 * Formula: reward = (sqrt(points_last_N_days) / sum_of_all_sqrt_weights) × pool_amount
 *
 * This provides:
 * - Merit-based distribution (more work = more reward)
 * - Diminishing returns (prevents monopolization)
 * - 30-day rolling window (prevents "rich get richer forever")
 *
 * @param activeContributors Array of active contributors
 * @param performancePoolAmount Total performance pool tokens to distribute
 * @param config Reward configuration (includes lookback window)
 * @param currentTime Current timestamp (for deterministic testing)
 * @returns Map of accountId → performance pool reward
 */
export function distributePerformancePool(
  activeContributors: Contributor[],
  performancePoolAmount: number,
  config: RewardConfig,
  currentTime: Date = new Date()
): Map<string, number> {
  const rewards = new Map<string, number>();

  // Edge case: No active contributors
  if (activeContributors.length === 0) {
    return rewards;
  }

  // Calculate sqrt weight for each contributor
  const weights = new Map<string, number>();
  let totalWeight = 0;

  for (const contributor of activeContributors) {
    const weight = calculatePerformanceWeight(contributor, config, currentTime);
    weights.set(contributor.accountId, weight);
    totalWeight += weight;
  }

  // Edge case: No one has any points (total weight = 0)
  if (totalWeight === 0) {
    // Distribute equally if no one has earned any points
    const equalShare = performancePoolAmount / activeContributors.length;
    for (const contributor of activeContributors) {
      rewards.set(contributor.accountId, equalShare);
    }
    return rewards;
  }

  // Distribute proportionally based on weights
  for (const contributor of activeContributors) {
    const weight = weights.get(contributor.accountId) || 0;
    const reward = (weight / totalWeight) * performancePoolAmount;
    rewards.set(contributor.accountId, reward);
  }

  return rewards;
}

/**
 * Calculate complete daily rewards (base pool + performance pool)
 *
 * This is the main entry point for daily reward distribution. It combines:
 * - Base pool: Equal share for all active contributors (fairness floor)
 * - Performance pool: Merit-based with sqrt diminishing returns
 *
 * The luck pool is optional and not yet implemented.
 *
 * @param contributors All contributors
 * @param config Reward configuration
 * @param currentTime Current timestamp (for deterministic testing)
 * @returns Array of ContributorReward with complete reward allocation
 */
export function calculateDailyRewards(
  contributors: Contributor[],
  config: RewardConfig,
  currentTime: Date = new Date()
): ContributorReward[] {
  // Get active contributors
  const activeContributors = getActiveContributors(contributors, config, currentTime);

  // Calculate pool amounts
  const basePoolAmount = calculateBasePoolAmount(config);
  const performancePoolAmount = calculatePerformancePoolAmount(config);

  // Distribute both pools
  const basePoolRewards = distributeBasePool(activeContributors, basePoolAmount);
  const performancePoolRewards = distributePerformancePool(
    activeContributors,
    performancePoolAmount,
    config,
    currentTime
  );

  // Combine rewards
  const rewards: ContributorReward[] = [];

  for (const contributor of activeContributors) {
    const baseReward = basePoolRewards.get(contributor.accountId) || 0;
    const performanceReward = performancePoolRewards.get(contributor.accountId) || 0;
    const totalReward = baseReward + performanceReward;

    const rewardPoints = calculateRewardPoints(contributor, config.performanceLookbackDays, currentTime);
    const sqrtWeight = calculatePerformanceWeight(contributor, config, currentTime);

    rewards.push({
      accountId: contributor.accountId,
      basePoolReward: baseReward,
      performancePoolReward: performanceReward,
      luckPoolReward: 0, // Not yet implemented
      totalReward,
      reason: `Base: ${baseReward.toFixed(2)} (equal share) + Performance: ${performanceReward.toFixed(2)} (${rewardPoints.toFixed(0)} points → ${sqrtWeight.toFixed(2)} weight) = ${totalReward.toFixed(2)} tokens`,
    });
  }

  return rewards;
}

/**
 * Calculate complete daily reward distribution with metadata
 *
 * This function returns a RewardDistribution object containing:
 * - Individual rewards for each contributor
 * - Metadata about the distribution (date, config, totals)
 * - Pool breakdowns for analytics
 *
 * @param contributors All contributors
 * @param config Reward configuration
 * @param currentTime Current timestamp (for deterministic testing)
 * @returns Complete RewardDistribution object
 */
export function calculateRewardDistribution(
  contributors: Contributor[],
  config: RewardConfig,
  currentTime: Date = new Date()
): RewardDistribution {
  const rewards = calculateDailyRewards(contributors, config, currentTime);
  const activeContributorCount = rewards.length;

  const basePoolTotal = calculateBasePoolAmount(config);
  const performancePoolTotal = calculatePerformancePoolAmount(config);
  const luckPoolTotal = 0; // Not yet implemented

  return {
    date: currentTime,
    config,
    totalEmissions: config.dailyEmissions,
    basePoolTotal,
    performancePoolTotal,
    luckPoolTotal,
    activeContributorCount,
    rewards,
  };
}

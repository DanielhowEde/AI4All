/**
 * AI4All Reward Distribution System - Fixed-Point Arithmetic Version
 *
 * This version uses bigint microunits for deterministic, auditable calculations.
 * Required for mainnet deployment with real money.
 *
 * Differences from floating-point version:
 * - All token amounts in nanounits (1 token = 1,000,000,000 nanounits)
 * - Deterministic across all platforms
 * - Exact sum preservation (no rounding errors)
 * - Uses integer square root
 */

import { Contributor, RewardConfig, ContributorReward, RewardDistribution } from './types';
import { isActiveContributor, calculateRewardPoints } from './computePoints';
import {
  NANO_UNITS,
  toNanoUnits,
  toTokens,
  distributeProportional,
  distributeSqrtWeighted,
  formatTokens,
} from './fixedPoint';

/**
 * Filter contributors to get only active ones for a given day
 * (Same as floating-point version)
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
 * Calculate base pool amount from daily emissions (in nanounits)
 */
export function calculateBasePoolAmount(config: RewardConfig): bigint {
  const dailyEmissionsNano = toNanoUnits(config.dailyEmissions);
  const basePercentage = BigInt(Math.floor(config.basePoolPercentage * 1_000_000_000));
  return (dailyEmissionsNano * basePercentage) / 1_000_000_000n;
}

/**
 * Calculate performance pool amount from daily emissions (in nanounits)
 */
export function calculatePerformancePoolAmount(config: RewardConfig): bigint {
  const dailyEmissionsNano = toNanoUnits(config.dailyEmissions);
  const perfPercentage = BigInt(Math.floor(config.performancePoolPercentage * 1_000_000_000));
  return (dailyEmissionsNano * perfPercentage) / 1_000_000_000n;
}

/**
 * Distribute base pool equally among active contributors (fixed-point)
 */
export function distributeBasePool(
  activeContributors: Contributor[],
  basePoolAmount: bigint
): Map<string, bigint> {
  const rewards = new Map<string, bigint>();

  if (activeContributors.length === 0) {
    return rewards;
  }

  // Equal weights for base pool
  const weights = activeContributors.map(() => NANO_UNITS); // 1.0 in nanounits

  // Distribute proportionally (will be equal since all weights are same)
  const shares = distributeProportional(weights, basePoolAmount);

  // Map shares to account IDs
  for (let i = 0; i < activeContributors.length; i++) {
    rewards.set(activeContributors[i].accountId, shares[i]);
  }

  return rewards;
}

/**
 * Distribute performance pool based on sqrt-weighted merit (fixed-point)
 */
export function distributePerformancePool(
  activeContributors: Contributor[],
  performancePoolAmount: bigint,
  config: RewardConfig,
  currentTime: Date = new Date()
): Map<string, bigint> {
  const rewards = new Map<string, bigint>();

  if (activeContributors.length === 0) {
    return rewards;
  }

  // Calculate reward points for each contributor (in microunits)
  const points = activeContributors.map(contributor => {
    const rewardPoints = calculateRewardPoints(
      contributor,
      config.performanceLookbackDays,
      currentTime
    );
    return toNanoUnits(rewardPoints);
  });

  // Distribute using sqrt weighting
  const shares = distributeSqrtWeighted(points, performancePoolAmount);

  // Map shares to account IDs
  for (let i = 0; i < activeContributors.length; i++) {
    rewards.set(activeContributors[i].accountId, shares[i]);
  }

  return rewards;
}

/**
 * Calculate complete daily rewards (base pool + performance pool) using fixed-point
 */
export function calculateDailyRewards(
  contributors: Contributor[],
  config: RewardConfig,
  currentTime: Date = new Date()
): ContributorReward[] {
  // Get active contributors
  const activeContributors = getActiveContributors(contributors, config, currentTime);

  // Calculate pool amounts (in microunits)
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
    const baseRewardMicro = basePoolRewards.get(contributor.accountId) || 0n;
    const performanceRewardMicro = performancePoolRewards.get(contributor.accountId) || 0n;
    const totalRewardMicro = baseRewardMicro + performanceRewardMicro;

    // Convert to tokens for display
    const baseReward = toTokens(baseRewardMicro);
    const performanceReward = toTokens(performanceRewardMicro);
    const totalReward = toTokens(totalRewardMicro);

    // Calculate weight for reason string
    const rewardPoints = calculateRewardPoints(
      contributor,
      config.performanceLookbackDays,
      currentTime
    );
    const sqrtWeight = Math.sqrt(rewardPoints); // For display only

    rewards.push({
      accountId: contributor.accountId,
      basePoolReward: baseReward,
      performancePoolReward: performanceReward,
      luckPoolReward: 0,
      totalReward,
      reason: `Base: ${formatTokens(baseRewardMicro)} (equal share) + Performance: ${formatTokens(performanceRewardMicro)} (${rewardPoints.toFixed(0)} points → ${sqrtWeight.toFixed(2)} weight) = ${formatTokens(totalRewardMicro)} tokens`,
    });
  }

  return rewards;
}

/**
 * Calculate complete daily reward distribution with metadata (fixed-point)
 */
export function calculateRewardDistribution(
  contributors: Contributor[],
  config: RewardConfig,
  currentTime: Date = new Date()
): RewardDistribution {
  const rewards = calculateDailyRewards(contributors, config, currentTime);
  const activeContributorCount = rewards.length;

  // Convert microunits to tokens for the distribution summary
  const basePoolTotal = toTokens(calculateBasePoolAmount(config));
  const performancePoolTotal = toTokens(calculatePerformancePoolAmount(config));
  const luckPoolTotal = 0;

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

/**
 * Verify that distribution sums exactly match emissions
 *
 * This is a key advantage of fixed-point arithmetic: we can verify exactness.
 */
export function verifyExactDistribution(
  distribution: RewardDistribution
): { valid: boolean; error?: string } {
  const totalDistributed = distribution.rewards.reduce(
    (sum, r) => sum + r.totalReward,
    0
  );

  const expectedTotal = distribution.config.dailyEmissions;

  // Convert to microunits for exact comparison
  const totalDistributedMicro = toNanoUnits(totalDistributed);
  const expectedTotalMicro = toNanoUnits(expectedTotal);

  if (totalDistributedMicro !== expectedTotalMicro) {
    return {
      valid: false,
      error: `Distribution sum (${totalDistributed}) does not exactly match emissions (${expectedTotal}). Difference: ${totalDistributed - expectedTotal} tokens`,
    };
  }

  return { valid: true };
}

/**
 * AI4All Reward Distribution System - Fixed-Point Arithmetic Version
 *
 * This version uses bigint microunits for deterministic, auditable calculations.
 * Required for mainnet deployment with real money.
 *
 * Differences from floating-point version:
 * - All token amounts in microunits (1 token = 1,000,000 microunits)
 * - Deterministic across all platforms
 * - Exact sum preservation (no rounding errors)
 * - Uses integer square root
 */

import { Contributor, RewardConfig, ContributorReward, RewardDistribution } from './types';
import { isActiveContributor, calculateRewardPoints } from './computePoints';
import {
  toMicroUnits,
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
 * Calculate base pool amount from daily emissions (in microunits)
 */
export function calculateBasePoolAmount(config: RewardConfig): bigint {
  const dailyEmissionsMicro = toMicroUnits(config.dailyEmissions);
  const basePercentage = BigInt(Math.floor(config.basePoolPercentage * 1_000_000));
  return (dailyEmissionsMicro * basePercentage) / 1_000_000n;
}

/**
 * Calculate performance pool amount from daily emissions (in microunits)
 */
export function calculatePerformancePoolAmount(config: RewardConfig): bigint {
  const dailyEmissionsMicro = toMicroUnits(config.dailyEmissions);
  const perfPercentage = BigInt(Math.floor(config.performancePoolPercentage * 1_000_000));
  return (dailyEmissionsMicro * perfPercentage) / 1_000_000n;
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
  const weights = activeContributors.map(() => 1_000_000n); // 1.0 in microunits

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
    return toMicroUnits(rewardPoints);
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
      reason: `Base: ${formatTokens(baseRewardMicro, 2)} (equal share) + Performance: ${formatTokens(performanceRewardMicro, 2)} (${rewardPoints.toFixed(0)} points → ${sqrtWeight.toFixed(2)} weight) = ${formatTokens(totalRewardMicro, 2)} tokens`,
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
  const totalDistributedMicro = toMicroUnits(totalDistributed);
  const expectedTotalMicro = toMicroUnits(expectedTotal);

  if (totalDistributedMicro !== expectedTotalMicro) {
    return {
      valid: false,
      error: `Distribution sum (${totalDistributed}) does not exactly match emissions (${expectedTotal}). Difference: ${totalDistributed - expectedTotal} tokens`,
    };
  }

  return { valid: true };
}

import { Contributor, RewardConfig, RewardDistribution } from '../types';
import {
  calculateRewardDistribution,
  verifyExactDistribution,
} from '../rewardDistributionFixed';
import { AuditEntry } from './serviceTypes';

/**
 * Calculate and verify daily reward distribution using fixed-point arithmetic.
 *
 * Pure function: wraps calculateRewardDistribution + verifyExactDistribution.
 */
export function finalizeDailyRewards(
  contributors: Contributor[],
  config: RewardConfig,
  currentTime: Date
): {
  distribution: RewardDistribution;
  verification: { valid: boolean; error?: string };
  audit: AuditEntry[];
} {
  const audit: AuditEntry[] = [];

  // Calculate rewards using fixed-point arithmetic
  const distribution = calculateRewardDistribution(
    contributors,
    config,
    currentTime
  );

  audit.push({
    timestamp: currentTime,
    eventType: 'REWARDS_DISTRIBUTED',
    details: {
      totalEmissions: distribution.totalEmissions,
      activeContributors: distribution.activeContributorCount,
      basePoolTotal: distribution.basePoolTotal,
      performancePoolTotal: distribution.performancePoolTotal,
      rewardCount: distribution.rewards.length,
    },
  });

  // Verify exact distribution
  const verification = verifyExactDistribution(distribution);

  audit.push({
    timestamp: currentTime,
    eventType: 'DISTRIBUTION_VERIFIED',
    details: {
      valid: verification.valid,
      error: verification.error,
    },
  });

  return { distribution, verification, audit };
}

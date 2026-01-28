import { RewardConfig, RewardDistribution } from '../types';
import { verifyExactDistribution } from '../rewardDistributionFixed';
import { isActiveContributor, isBlockedByRecentCanaryFailure } from '../computePoints';
import {
  AuditEntry,
  AuditEventType,
  NetworkState,
  NetworkHealthStats,
} from './serviceTypes';

/**
 * Append audit entries to an existing log (pure: returns new array).
 */
export function appendAuditEntries(
  existingLog: AuditEntry[],
  newEntries: AuditEntry[]
): AuditEntry[] {
  return [...existingLog, ...newEntries];
}

/**
 * Audit a reward distribution for correctness.
 */
export function auditDistribution(
  distribution: RewardDistribution,
  timestamp: Date
): { valid: boolean; error?: string; audit: AuditEntry } {
  const result = verifyExactDistribution(distribution);

  const audit: AuditEntry = {
    timestamp,
    eventType: 'DISTRIBUTION_VERIFIED',
    details: {
      valid: result.valid,
      error: result.error,
      totalEmissions: distribution.totalEmissions,
      rewardCount: distribution.rewards.length,
    },
  };

  return { ...result, audit };
}

/**
 * Calculate network health statistics from current state.
 */
export function calculateNetworkHealth(
  state: NetworkState,
  config: RewardConfig,
  currentTime: Date
): NetworkHealthStats {
  const contributors = Array.from(state.contributors.values());

  const activeNodes = contributors.filter(c =>
    isActiveContributor(c, config, currentTime)
  ).length;

  const blockedNodes = contributors.filter(c =>
    isBlockedByRecentCanaryFailure(c, config, currentTime)
  ).length;

  const totalCanaryFailures = contributors.reduce(
    (sum, c) => sum + c.canaryFailures,
    0
  );

  const totalCanaryPasses = contributors.reduce(
    (sum, c) => sum + c.canaryPasses,
    0
  );

  const avgReputation =
    contributors.length > 0
      ? contributors.reduce((sum, c) => sum + c.reputationMultiplier, 0) /
        contributors.length
      : 0;

  return {
    totalNodes: contributors.length,
    activeNodes,
    blockedNodes,
    totalCanaryFailures,
    totalCanaryPasses,
    avgReputation,
  };
}

/**
 * Query audit log with optional filters.
 */
export function queryAuditLog(
  log: AuditEntry[],
  filters: {
    eventType?: AuditEventType;
    accountId?: string;
    fromTime?: Date;
    toTime?: Date;
  }
): AuditEntry[] {
  return log.filter(entry => {
    if (filters.eventType && entry.eventType !== filters.eventType) return false;
    if (filters.accountId && entry.accountId !== filters.accountId) return false;
    if (filters.fromTime && entry.timestamp < filters.fromTime) return false;
    if (filters.toTime && entry.timestamp > filters.toTime) return false;
    return true;
  });
}

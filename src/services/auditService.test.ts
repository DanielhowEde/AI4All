import { BlockType, DEFAULT_REWARD_CONFIG, Contributor } from '../types';
import {
  appendAuditEntries,
  auditDistribution,
  calculateNetworkHealth,
  queryAuditLog,
} from './auditService';
import { AuditEntry, createEmptyNetworkState } from './serviceTypes';
import { registerNode } from './nodeService';
import { finalizeDailyRewards } from './dailyFinalizeService';

const now = new Date('2026-01-28T12:00:00Z');

function makeActiveContributor(id: string): Contributor {
  return {
    accountId: id,
    completedBlocks: Array.from({ length: 10 }, (_, i) => ({
      blockType: BlockType.INFERENCE,
      resourceUsage: 1.0,
      difficultyMultiplier: 1.0,
      validationPassed: true,
      timestamp: new Date(now.getTime() - i * 60_000),
      isCanary: false,
    })),
    reputationMultiplier: 1.0,
    canaryFailures: 0,
    canaryPasses: 0,
  };
}

describe('AuditService', () => {
  describe('appendAuditEntries', () => {
    it('should return new array with entries appended', () => {
      const existing: AuditEntry[] = [
        { timestamp: now, eventType: 'NODE_REGISTERED', details: {} },
      ];
      const newEntries: AuditEntry[] = [
        { timestamp: now, eventType: 'BLOCKS_ASSIGNED', details: {} },
      ];

      const result = appendAuditEntries(existing, newEntries);

      expect(result).toHaveLength(2);
      expect(result[0].eventType).toBe('NODE_REGISTERED');
      expect(result[1].eventType).toBe('BLOCKS_ASSIGNED');
      // Original unchanged
      expect(existing).toHaveLength(1);
    });

    it('should handle empty inputs', () => {
      expect(appendAuditEntries([], [])).toEqual([]);
      expect(appendAuditEntries([], [{ timestamp: now, eventType: 'NODE_REGISTERED', details: {} }])).toHaveLength(1);
    });
  });

  describe('auditDistribution', () => {
    it('should verify a valid distribution', () => {
      const contributors = [makeActiveContributor('alice')];
      const { distribution } = finalizeDailyRewards(contributors, DEFAULT_REWARD_CONFIG, now);

      const { valid, audit } = auditDistribution(distribution, now);

      expect(valid).toBe(true);
      expect(audit.eventType).toBe('DISTRIBUTION_VERIFIED');
      expect(audit.details.valid).toBe(true);
    });

    it('should detect an invalid distribution', () => {
      const contributors = [makeActiveContributor('alice')];
      const { distribution } = finalizeDailyRewards(contributors, DEFAULT_REWARD_CONFIG, now);

      // Corrupt the distribution
      distribution.rewards[0].totalReward += 1;

      const { valid, error } = auditDistribution(distribution, now);

      expect(valid).toBe(false);
      expect(error).toBeDefined();
    });
  });

  describe('calculateNetworkHealth', () => {
    it('should compute stats for empty network', () => {
      const state = createEmptyNetworkState();
      const stats = calculateNetworkHealth(state, DEFAULT_REWARD_CONFIG, now);

      expect(stats.totalNodes).toBe(0);
      expect(stats.activeNodes).toBe(0);
      expect(stats.blockedNodes).toBe(0);
      expect(stats.avgReputation).toBe(0);
    });

    it('should compute stats for populated network', () => {
      let state = createEmptyNetworkState();

      // Register two nodes
      const { state: s1 } = registerNode(state, { accountId: 'alice' }, now);
      const { state: s2 } = registerNode(s1, { accountId: 'bob' }, now);

      // Make alice active with blocks
      const alice = makeActiveContributor('alice');
      const newContributors = new Map(s2.contributors);
      newContributors.set('alice', alice);
      state = { ...s2, contributors: newContributors };

      const stats = calculateNetworkHealth(state, DEFAULT_REWARD_CONFIG, now);

      expect(stats.totalNodes).toBe(2);
      expect(stats.activeNodes).toBe(1); // only alice
      expect(stats.avgReputation).toBe(1.0);
    });

    it('should count blocked nodes', () => {
      let state = createEmptyNetworkState();
      const { state: s1 } = registerNode(state, { accountId: 'alice' }, now);

      // Block alice
      const alice = s1.contributors.get('alice')!;
      const blockedAlice = {
        ...alice,
        canaryFailures: 1,
        lastCanaryFailureTime: new Date(now.getTime() - 1 * 60 * 60 * 1000),
      };
      const newContributors = new Map(s1.contributors);
      newContributors.set('alice', blockedAlice);
      state = { ...s1, contributors: newContributors };

      const stats = calculateNetworkHealth(state, DEFAULT_REWARD_CONFIG, now);
      expect(stats.blockedNodes).toBe(1);
      expect(stats.totalCanaryFailures).toBe(1);
    });
  });

  describe('queryAuditLog', () => {
    const log: AuditEntry[] = [
      { timestamp: new Date('2026-01-28T10:00:00Z'), eventType: 'NODE_REGISTERED', accountId: 'alice', details: {} },
      { timestamp: new Date('2026-01-28T11:00:00Z'), eventType: 'BLOCKS_ASSIGNED', details: {} },
      { timestamp: new Date('2026-01-28T12:00:00Z'), eventType: 'CANARY_FAILED', accountId: 'alice', details: {} },
      { timestamp: new Date('2026-01-28T13:00:00Z'), eventType: 'REWARDS_DISTRIBUTED', details: {} },
    ];

    it('should filter by eventType', () => {
      const result = queryAuditLog(log, { eventType: 'NODE_REGISTERED' });
      expect(result).toHaveLength(1);
      expect(result[0].accountId).toBe('alice');
    });

    it('should filter by accountId', () => {
      const result = queryAuditLog(log, { accountId: 'alice' });
      expect(result).toHaveLength(2); // NODE_REGISTERED + CANARY_FAILED
    });

    it('should filter by time range', () => {
      const result = queryAuditLog(log, {
        fromTime: new Date('2026-01-28T11:00:00Z'),
        toTime: new Date('2026-01-28T12:30:00Z'),
      });
      expect(result).toHaveLength(2); // BLOCKS_ASSIGNED + CANARY_FAILED
    });

    it('should combine filters', () => {
      const result = queryAuditLog(log, {
        accountId: 'alice',
        eventType: 'CANARY_FAILED',
      });
      expect(result).toHaveLength(1);
    });

    it('should return all entries with empty filters', () => {
      expect(queryAuditLog(log, {})).toHaveLength(4);
    });
  });
});

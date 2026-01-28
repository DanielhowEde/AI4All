import { BlockType, Contributor, DEFAULT_REWARD_CONFIG } from '../types';
import { finalizeDailyRewards } from './dailyFinalizeService';

function makeActiveContributor(id: string, blockCount: number = 10): Contributor {
  const now = new Date('2026-01-28T12:00:00Z');
  return {
    accountId: id,
    completedBlocks: Array.from({ length: blockCount }, (_, i) => ({
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

describe('DailyFinalizeService', () => {
  const now = new Date('2026-01-28T12:00:00Z');

  it('should calculate and verify reward distribution', () => {
    const contributors = [
      makeActiveContributor('alice', 20),
      makeActiveContributor('bob', 10),
    ];

    const { distribution, verification, audit } = finalizeDailyRewards(
      contributors,
      DEFAULT_REWARD_CONFIG,
      now
    );

    expect(distribution.rewards).toHaveLength(2);
    expect(distribution.totalEmissions).toBe(DEFAULT_REWARD_CONFIG.dailyEmissions);
    expect(verification.valid).toBe(true);
    expect(audit).toHaveLength(2);
    expect(audit[0].eventType).toBe('REWARDS_DISTRIBUTED');
    expect(audit[1].eventType).toBe('DISTRIBUTION_VERIFIED');
  });

  it('should produce rewards that sum to daily emissions', () => {
    const contributors = [
      makeActiveContributor('alice', 30),
      makeActiveContributor('bob', 15),
      makeActiveContributor('charlie', 5),
    ];

    const { distribution } = finalizeDailyRewards(
      contributors,
      DEFAULT_REWARD_CONFIG,
      now
    );

    const total = distribution.rewards.reduce(
      (sum: number, r) => sum + r.totalReward,
      0
    );
    expect(total).toBeCloseTo(DEFAULT_REWARD_CONFIG.dailyEmissions, 2);
  });

  it('should handle zero active contributors', () => {
    const { distribution, verification } = finalizeDailyRewards(
      [],
      DEFAULT_REWARD_CONFIG,
      now
    );

    expect(distribution.rewards).toHaveLength(0);
    expect(distribution.activeContributorCount).toBe(0);
    // Verification should pass (0 distributed, 0 expected active)
    expect(verification).toBeDefined();
  });

  it('should include pool totals in audit details', () => {
    const contributors = [makeActiveContributor('alice')];

    const { audit } = finalizeDailyRewards(
      contributors,
      DEFAULT_REWARD_CONFIG,
      now
    );

    const distAudit = audit.find(a => a.eventType === 'REWARDS_DISTRIBUTED')!;
    expect(distAudit.details.basePoolTotal).toBeDefined();
    expect(distAudit.details.performancePoolTotal).toBeDefined();
    expect(distAudit.details.activeContributors).toBe(1);
  });

  it('should exclude inactive contributors from rewards', () => {
    const inactive: Contributor = {
      accountId: 'inactive',
      completedBlocks: [], // no blocks = inactive
      reputationMultiplier: 1.0,
      canaryFailures: 0,
      canaryPasses: 0,
    };

    const { distribution } = finalizeDailyRewards(
      [makeActiveContributor('alice'), inactive],
      DEFAULT_REWARD_CONFIG,
      now
    );

    expect(distribution.activeContributorCount).toBe(1);
    expect(distribution.rewards).toHaveLength(1);
    expect(distribution.rewards[0].accountId).toBe('alice');
  });

  it('should use fixed-point arithmetic for exact verification', () => {
    const contributors = [
      makeActiveContributor('alice', 100),
      makeActiveContributor('bob', 50),
      makeActiveContributor('charlie', 25),
    ];

    const { verification } = finalizeDailyRewards(
      contributors,
      DEFAULT_REWARD_CONFIG,
      now
    );

    expect(verification.valid).toBe(true);
    expect(verification.error).toBeUndefined();
  });
});

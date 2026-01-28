import {
  BlockType,
  Contributor,
  DEFAULT_BLOCK_ASSIGNMENT_CONFIG,
} from '../types';
import { DEFAULT_CANARY_CONFIG } from '../canaryGenerator';
import { assignDailyWork, getAssignedBlockIds } from './workAssignmentService';
import { seededRandom } from '../canaryGenerator';

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

describe('WorkAssignmentService', () => {
  const now = new Date('2026-01-28T12:00:00Z');
  const rng = seededRandom(42);

  describe('assignDailyWork', () => {
    it('should return assignments for active contributors', () => {
      const contributors = [
        makeActiveContributor('alice'),
        makeActiveContributor('bob'),
      ];

      const { assignments, canaryBlockIds, audit } = assignDailyWork(
        contributors,
        DEFAULT_BLOCK_ASSIGNMENT_CONFIG,
        DEFAULT_CANARY_CONFIG,
        now,
        rng
      );

      expect(assignments.length).toBeGreaterThan(0);
      expect(canaryBlockIds.size).toBeGreaterThan(0);
      expect(audit).toHaveLength(2); // BLOCKS_ASSIGNED + CANARIES_INJECTED
      expect(audit[0].eventType).toBe('BLOCKS_ASSIGNED');
      expect(audit[1].eventType).toBe('CANARIES_INJECTED');
    });

    it('should produce canary block IDs that are a subset of all assigned blocks', () => {
      const contributors = [
        makeActiveContributor('alice'),
        makeActiveContributor('bob'),
      ];

      const { assignments, canaryBlockIds } = assignDailyWork(
        contributors,
        DEFAULT_BLOCK_ASSIGNMENT_CONFIG,
        DEFAULT_CANARY_CONFIG,
        now,
        seededRandom(99)
      );

      const allBlockIds = new Set(assignments.flatMap(a => a.blockIds));
      for (const cid of canaryBlockIds) {
        expect(allBlockIds.has(cid)).toBe(true);
      }
    });

    it('should return empty results for empty contributor list', () => {
      const { assignments, canaryBlockIds } = assignDailyWork(
        [],
        DEFAULT_BLOCK_ASSIGNMENT_CONFIG,
        DEFAULT_CANARY_CONFIG,
        now
      );

      expect(assignments).toEqual([]);
      expect(canaryBlockIds.size).toBe(0);
    });

    it('should be deterministic with seeded random', () => {
      const contributors = [
        makeActiveContributor('alice'),
        makeActiveContributor('bob'),
      ];

      const r1 = assignDailyWork(
        contributors,
        DEFAULT_BLOCK_ASSIGNMENT_CONFIG,
        DEFAULT_CANARY_CONFIG,
        now,
        seededRandom(123)
      );

      const r2 = assignDailyWork(
        contributors,
        DEFAULT_BLOCK_ASSIGNMENT_CONFIG,
        DEFAULT_CANARY_CONFIG,
        now,
        seededRandom(123)
      );

      expect(r1.assignments.length).toBe(r2.assignments.length);
      for (let i = 0; i < r1.assignments.length; i++) {
        expect(r1.assignments[i].contributorId).toBe(r2.assignments[i].contributorId);
      }
    });

    it('should include canary percentage in audit details', () => {
      const contributors = [makeActiveContributor('alice')];

      const { audit } = assignDailyWork(
        contributors,
        DEFAULT_BLOCK_ASSIGNMENT_CONFIG,
        DEFAULT_CANARY_CONFIG,
        now,
        seededRandom(42)
      );

      const canaryAudit = audit.find(a => a.eventType === 'CANARIES_INJECTED');
      expect(canaryAudit).toBeDefined();
      expect(canaryAudit!.details.canaryPercentage).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getAssignedBlockIds', () => {
    it('should return block IDs for a specific contributor', () => {
      const contributors = [
        makeActiveContributor('alice'),
        makeActiveContributor('bob'),
      ];

      const { assignments } = assignDailyWork(
        contributors,
        DEFAULT_BLOCK_ASSIGNMENT_CONFIG,
        DEFAULT_CANARY_CONFIG,
        now,
        seededRandom(42)
      );

      const aliceBlocks = getAssignedBlockIds(assignments, 'alice');
      const bobBlocks = getAssignedBlockIds(assignments, 'bob');

      // Both should have blocks (weighted lottery)
      expect(aliceBlocks.length + bobBlocks.length).toBe(
        assignments.flatMap(a => a.blockIds).length
      );
    });

    it('should return empty array for unknown contributor', () => {
      expect(getAssignedBlockIds([], 'nobody')).toEqual([]);
    });
  });
});

import { BlockType, Contributor, DEFAULT_REWARD_CONFIG } from '../types';
import { processSubmission, processBatchSubmissions } from './submissionService';
import { BlockSubmission } from './serviceTypes';

function makeContributor(id: string): Contributor {
  return {
    accountId: id,
    completedBlocks: [],
    reputationMultiplier: 1.0,
    canaryFailures: 0,
    canaryPasses: 0,
  };
}

function makeSubmission(
  contributorId: string,
  blockId: string,
  canaryCorrect?: boolean
): BlockSubmission {
  return {
    contributorId,
    blockId,
    blockType: BlockType.INFERENCE,
    resourceUsage: 0.8,
    difficultyMultiplier: 1.2,
    validationPassed: true,
    canaryAnswerCorrect: canaryCorrect,
    timestamp: new Date('2026-01-28T12:00:00Z'),
  };
}

describe('SubmissionService', () => {
  describe('processSubmission', () => {
    it('should add a normal block to contributor', () => {
      const contributor = makeContributor('alice');
      const submission = makeSubmission('alice', 'block-1');

      const { contributor: updated, result } = processSubmission(
        contributor,
        submission,
        false, // not canary
        DEFAULT_REWARD_CONFIG
      );

      expect(updated.completedBlocks).toHaveLength(1);
      expect(updated.completedBlocks[0].blockType).toBe(BlockType.INFERENCE);
      expect(updated.completedBlocks[0].resourceUsage).toBe(0.8);
      expect(updated.completedBlocks[0].difficultyMultiplier).toBe(1.2);
      expect(updated.completedBlocks[0].isCanary).toBe(false);
      expect(result.canaryDetected).toBe(false);
      expect(result.canaryPassed).toBeUndefined();
      expect(result.penaltyApplied).toBe(false);
    });

    it('should not mutate original contributor', () => {
      const contributor = makeContributor('alice');
      const originalBlockCount = contributor.completedBlocks.length;

      processSubmission(
        contributor,
        makeSubmission('alice', 'block-1'),
        false,
        DEFAULT_REWARD_CONFIG
      );

      expect(contributor.completedBlocks.length).toBe(originalBlockCount);
    });

    it('should handle canary pass correctly', () => {
      const contributor = makeContributor('alice');
      const submission = makeSubmission('alice', 'canary-1', true);

      const { contributor: updated, result, audit } = processSubmission(
        contributor,
        submission,
        true, // is canary
        DEFAULT_REWARD_CONFIG
      );

      expect(updated.canaryPasses).toBe(1);
      expect(updated.canaryFailures).toBe(0);
      expect(updated.reputationMultiplier).toBe(1.0); // unchanged
      expect(result.canaryDetected).toBe(true);
      expect(result.canaryPassed).toBe(true);
      expect(result.penaltyApplied).toBe(false);
      expect(audit.some(a => a.eventType === 'CANARY_PASSED')).toBe(true);
    });

    it('should handle canary failure with penalty', () => {
      const contributor = makeContributor('alice');
      const submission = makeSubmission('alice', 'canary-1', false);

      const { contributor: updated, result, audit } = processSubmission(
        contributor,
        submission,
        true, // is canary
        DEFAULT_REWARD_CONFIG
      );

      expect(updated.canaryFailures).toBe(1);
      expect(updated.canaryPasses).toBe(0);
      expect(updated.reputationMultiplier).toBeLessThan(1.0); // penalty applied
      expect(updated.lastCanaryFailureTime).toEqual(submission.timestamp);
      expect(result.canaryDetected).toBe(true);
      expect(result.canaryPassed).toBe(false);
      expect(result.penaltyApplied).toBe(true);
      expect(audit.some(a => a.eventType === 'CANARY_FAILED')).toBe(true);
    });

    it('should accumulate canary failures', () => {
      let contributor = makeContributor('alice');

      // First failure
      const { contributor: c1 } = processSubmission(
        contributor,
        makeSubmission('alice', 'canary-1', false),
        true,
        DEFAULT_REWARD_CONFIG
      );
      expect(c1.canaryFailures).toBe(1);

      // Second failure
      const { contributor: c2 } = processSubmission(
        c1,
        makeSubmission('alice', 'canary-2', false),
        true,
        DEFAULT_REWARD_CONFIG
      );
      expect(c2.canaryFailures).toBe(2);
      expect(c2.reputationMultiplier).toBeLessThan(c1.reputationMultiplier);
    });

    it('should mark canary block correctly in completedBlocks', () => {
      const contributor = makeContributor('alice');

      const { contributor: updated } = processSubmission(
        contributor,
        makeSubmission('alice', 'canary-1', true),
        true,
        DEFAULT_REWARD_CONFIG
      );

      expect(updated.completedBlocks[0].isCanary).toBe(true);
      expect(updated.completedBlocks[0].canaryAnswerCorrect).toBe(true);
    });

    it('should generate SUBMISSION_ACCEPTED audit for every submission', () => {
      const contributor = makeContributor('alice');

      const { audit: normalAudit } = processSubmission(
        contributor,
        makeSubmission('alice', 'block-1'),
        false,
        DEFAULT_REWARD_CONFIG
      );
      expect(normalAudit.some(a => a.eventType === 'SUBMISSION_ACCEPTED')).toBe(true);

      const { audit: canaryAudit } = processSubmission(
        contributor,
        makeSubmission('alice', 'canary-1', true),
        true,
        DEFAULT_REWARD_CONFIG
      );
      expect(canaryAudit.some(a => a.eventType === 'SUBMISSION_ACCEPTED')).toBe(true);
    });
  });

  describe('processBatchSubmissions', () => {
    it('should process multiple submissions for multiple contributors', () => {
      const contributors = new Map<string, Contributor>([
        ['alice', makeContributor('alice')],
        ['bob', makeContributor('bob')],
      ]);

      const submissions: BlockSubmission[] = [
        makeSubmission('alice', 'block-1'),
        makeSubmission('bob', 'block-2'),
        makeSubmission('alice', 'block-3'),
      ];

      const { updatedContributors, results, audit } = processBatchSubmissions(
        contributors,
        submissions,
        new Set(), // no canaries
        DEFAULT_REWARD_CONFIG
      );

      expect(updatedContributors.get('alice')!.completedBlocks).toHaveLength(2);
      expect(updatedContributors.get('bob')!.completedBlocks).toHaveLength(1);
      expect(results).toHaveLength(3);
      expect(audit.length).toBeGreaterThanOrEqual(3);
    });

    it('should not mutate original contributors map', () => {
      const alice = makeContributor('alice');
      const contributors = new Map([['alice', alice]]);

      processBatchSubmissions(
        contributors,
        [makeSubmission('alice', 'block-1')],
        new Set(),
        DEFAULT_REWARD_CONFIG
      );

      expect(contributors.get('alice')!.completedBlocks).toHaveLength(0);
    });

    it('should detect canary blocks from canaryBlockIds set', () => {
      const contributors = new Map([['alice', makeContributor('alice')]]);

      const canaryBlockIds = new Set(['canary-1']);
      const { results } = processBatchSubmissions(
        contributors,
        [
          makeSubmission('alice', 'block-1'),
          makeSubmission('alice', 'canary-1', true),
        ],
        canaryBlockIds,
        DEFAULT_REWARD_CONFIG
      );

      expect(results[0].canaryDetected).toBe(false);
      expect(results[1].canaryDetected).toBe(true);
      expect(results[1].canaryPassed).toBe(true);
    });

    it('should throw for unknown contributor', () => {
      const contributors = new Map<string, Contributor>();

      expect(() =>
        processBatchSubmissions(
          contributors,
          [makeSubmission('nobody', 'block-1')],
          new Set(),
          DEFAULT_REWARD_CONFIG
        )
      ).toThrow('Unknown contributor: nobody');
    });

    it('should apply canary failure penalty in batch', () => {
      const contributors = new Map([['alice', makeContributor('alice')]]);
      const canaryBlockIds = new Set(['canary-1']);

      const { updatedContributors, results } = processBatchSubmissions(
        contributors,
        [makeSubmission('alice', 'canary-1', false)], // failed canary
        canaryBlockIds,
        DEFAULT_REWARD_CONFIG
      );

      expect(updatedContributors.get('alice')!.canaryFailures).toBe(1);
      expect(updatedContributors.get('alice')!.reputationMultiplier).toBeLessThan(1.0);
      expect(results[0].penaltyApplied).toBe(true);
    });

    it('should handle empty submissions', () => {
      const contributors = new Map([['alice', makeContributor('alice')]]);

      const { results, audit } = processBatchSubmissions(
        contributors,
        [],
        new Set(),
        DEFAULT_REWARD_CONFIG
      );

      expect(results).toEqual([]);
      expect(audit).toEqual([]);
    });
  });
});

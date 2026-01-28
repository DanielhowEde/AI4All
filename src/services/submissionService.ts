import { Contributor, CompletedBlock, RewardConfig } from '../types';
import { calculateReputationWithCanaryPenalty } from '../computePoints';
import { BlockSubmission, SubmissionResult, AuditEntry } from './serviceTypes';

/**
 * Process a single block submission. Returns an updated contributor (immutable)
 * and a submission result indicating canary outcome and penalties.
 */
export function processSubmission(
  contributor: Contributor,
  submission: BlockSubmission,
  isCanaryBlock: boolean,
  config: RewardConfig
): { contributor: Contributor; result: SubmissionResult; audit: AuditEntry[] } {
  const audit: AuditEntry[] = [];

  // Build the completed block
  const block: CompletedBlock = {
    blockType: submission.blockType,
    resourceUsage: submission.resourceUsage,
    difficultyMultiplier: submission.difficultyMultiplier,
    validationPassed: submission.validationPassed,
    timestamp: submission.timestamp,
    isCanary: isCanaryBlock,
    canaryAnswerCorrect: isCanaryBlock ? submission.canaryAnswerCorrect : undefined,
  };

  // Start building updated contributor (immutable)
  let canaryFailures = contributor.canaryFailures;
  let canaryPasses = contributor.canaryPasses;
  let reputationMultiplier = contributor.reputationMultiplier;
  let lastCanaryFailureTime = contributor.lastCanaryFailureTime;

  let canaryDetected = false;
  let canaryPassed: boolean | undefined;
  let penaltyApplied = false;

  if (isCanaryBlock) {
    canaryDetected = true;

    if (submission.canaryAnswerCorrect) {
      canaryPassed = true;
      canaryPasses += 1;

      audit.push({
        timestamp: submission.timestamp,
        eventType: 'CANARY_PASSED',
        accountId: submission.contributorId,
        details: { blockId: submission.blockId },
      });
    } else {
      canaryPassed = false;
      canaryFailures += 1;
      lastCanaryFailureTime = submission.timestamp;
      penaltyApplied = true;

      // Recalculate reputation after failure
      reputationMultiplier = calculateReputationWithCanaryPenalty(
        1.0, // base reputation
        canaryFailures,
        config
      );

      audit.push({
        timestamp: submission.timestamp,
        eventType: 'CANARY_FAILED',
        accountId: submission.contributorId,
        details: {
          blockId: submission.blockId,
          totalFailures: canaryFailures,
          newReputation: reputationMultiplier,
        },
      });
    }
  }

  // Always log the submission
  audit.push({
    timestamp: submission.timestamp,
    eventType: 'SUBMISSION_ACCEPTED',
    accountId: submission.contributorId,
    details: {
      blockId: submission.blockId,
      blockType: submission.blockType,
      isCanary: isCanaryBlock,
    },
  });

  const updatedContributor: Contributor = {
    ...contributor,
    completedBlocks: [...contributor.completedBlocks, block],
    canaryFailures,
    canaryPasses,
    reputationMultiplier,
    lastCanaryFailureTime,
  };

  const result: SubmissionResult = {
    contributorId: submission.contributorId,
    blockId: submission.blockId,
    canaryDetected,
    canaryPassed,
    penaltyApplied,
  };

  return { contributor: updatedContributor, result, audit };
}

/**
 * Process a batch of submissions across multiple contributors.
 * Returns updated contributor map and all results.
 */
export function processBatchSubmissions(
  contributors: Map<string, Contributor>,
  submissions: BlockSubmission[],
  canaryBlockIds: Set<string>,
  config: RewardConfig
): {
  updatedContributors: Map<string, Contributor>;
  results: SubmissionResult[];
  audit: AuditEntry[];
} {
  const updatedContributors = new Map(contributors);
  const results: SubmissionResult[] = [];
  const audit: AuditEntry[] = [];

  for (const submission of submissions) {
    const contributor = updatedContributors.get(submission.contributorId);
    if (!contributor) {
      throw new Error(`Unknown contributor: ${submission.contributorId}`);
    }

    const isCanary = canaryBlockIds.has(submission.blockId);
    const outcome = processSubmission(contributor, submission, isCanary, config);

    updatedContributors.set(submission.contributorId, outcome.contributor);
    results.push(outcome.result);
    audit.push(...outcome.audit);
  }

  return { updatedContributors, results, audit };
}

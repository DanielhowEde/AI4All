import {
  NetworkState,
  DayConfig,
  DayResult,
  BlockSubmission,
} from './serviceTypes';
import { listActiveNodes } from './nodeService';
import { assignDailyWork } from './workAssignmentService';
import { processBatchSubmissions } from './submissionService';
import { finalizeDailyRewards } from './dailyFinalizeService';
import { appendAuditEntries } from './auditService';

/**
 * Orchestrate a full day: assign work, process submissions, finalize rewards.
 *
 * Pure function: takes state in, returns new state + results.
 * Submissions are provided as input (simulating what nodes would return).
 */
export function simulateDay(
  state: NetworkState,
  submissions: BlockSubmission[],
  config: DayConfig
): { newState: NetworkState; result: DayResult } {
  // 1. Get active contributors
  const activeContributors = listActiveNodes(
    state,
    config.rewardConfig,
    config.currentTime
  );

  // 2. Assign daily work + inject canaries
  const {
    assignments,
    canaryBlockIds,
    audit: assignAudit,
  } = assignDailyWork(
    activeContributors,
    config.blockAssignmentConfig,
    config.canaryConfig,
    config.currentTime,
    config.random
  );

  // 3. Process all submissions
  const {
    updatedContributors,
    results: submissionResults,
    audit: submissionAudit,
  } = processBatchSubmissions(
    state.contributors,
    submissions,
    canaryBlockIds,
    config.rewardConfig
  );

  // 4. Finalize daily rewards
  const {
    distribution: rewardDistribution,
    verification,
    audit: rewardAudit,
  } = finalizeDailyRewards(
    Array.from(updatedContributors.values()),
    config.rewardConfig,
    config.currentTime
  );

  // 5. Combine all audit entries
  const dayAudit = [...assignAudit, ...submissionAudit, ...rewardAudit];
  const combinedAuditLog = appendAuditEntries(state.auditLog, dayAudit);

  // 6. Build new state
  const newState: NetworkState = {
    contributors: updatedContributors,
    canaryBlockIds,
    auditLog: combinedAuditLog,
    dayNumber: state.dayNumber + 1,
  };

  const result: DayResult = {
    assignments,
    canaryBlockIds: Array.from(canaryBlockIds),
    submissionResults,
    updatedContributors,
    rewardDistribution,
    audit: dayAudit,
    verification,
  };

  return { newState, result };
}

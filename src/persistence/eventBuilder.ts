import * as crypto from 'crypto';
import { DomainEvent, DomainEventType } from './eventTypes';
import { canonicalStringify, computeHash } from './canonicalSerialize';
import { DayResult, BlockSubmission, NetworkState } from '../services/serviceTypes';

function uuidv4(): string {
  return crypto.randomUUID();
}

/**
 * Compute the hash of a domain event (timestamp excluded).
 */
export function computeEventHash(
  event: Omit<DomainEvent, 'eventHash'>
): string {
  const data = canonicalStringify({
    eventId: event.eventId,
    dayId: event.dayId,
    sequenceNumber: event.sequenceNumber,
    eventType: event.eventType,
    actorId: event.actorId,
    payload: event.payload,
    prevEventHash: event.prevEventHash,
  });
  return computeHash(data);
}

/**
 * Compute a deterministic hash of the full NetworkState.
 * Excludes auditLog since events serve as the audit trail.
 */
export function computeStateHash(state: NetworkState): string {
  const { auditLog, ...stateWithoutAudit } = state;
  return computeHash(canonicalStringify(stateWithoutAudit));
}

/**
 * Compute a deterministic hash of the reward list.
 * Only hashes accountId and totalReward for consistency.
 */
export function computeRewardHash(
  rewards: Array<{ accountId: string; totalReward: number }>
): string {
  const sorted = [...rewards]
    .map(r => ({ accountId: r.accountId, totalReward: r.totalReward }))
    .sort((a, b) => (a.accountId < b.accountId ? -1 : 1));
  return computeHash(canonicalStringify(sorted));
}

function makeEvent(
  dayId: string,
  seq: number,
  eventType: DomainEventType,
  payload: Record<string, unknown>,
  prevHash: string,
  actorId?: string,
  timestamp?: string
): DomainEvent {
  const partial: Omit<DomainEvent, 'eventHash'> = {
    eventId: uuidv4(),
    dayId,
    sequenceNumber: seq,
    timestamp: timestamp ?? new Date().toISOString(),
    eventType,
    actorId,
    payload,
    prevEventHash: prevHash,
  };
  return { ...partial, eventHash: computeEventHash(partial) };
}

/**
 * Build all domain events for a completed day.
 */
export function buildDayEvents(
  dayId: string,
  dayResult: DayResult,
  submissions: BlockSubmission[],
  prevEventHash: string,
  timestamp?: string
): DomainEvent[] {
  const events: DomainEvent[] = [];
  let seq = 0;
  let prevHash = prevEventHash;
  const ts = timestamp ?? new Date().toISOString();

  function emit(
    eventType: DomainEventType,
    payload: Record<string, unknown>,
    actorId?: string
  ): void {
    const event = makeEvent(dayId, seq++, eventType, payload, prevHash, actorId, ts);
    prevHash = event.eventHash;
    events.push(event);
  }

  // 1. WORK_ASSIGNED
  if (dayResult.assignments.length > 0) {
    emit('WORK_ASSIGNED', {
      assignments: dayResult.assignments.map(a => ({
        contributorId: a.contributorId,
        blockIds: a.blockIds,
      })),
      totalBlocks: dayResult.assignments.reduce(
        (sum, a) => sum + a.blockIds.length,
        0
      ),
    });
  }

  // 2. CANARIES_SELECTED
  if (dayResult.canaryBlockIds.length > 0) {
    emit('CANARIES_SELECTED', {
      canaryBlockIds: [...dayResult.canaryBlockIds].sort(),
    });
  }

  // 3. Submissions: SUBMISSION_RECEIVED + SUBMISSION_PROCESSED pairs
  for (let i = 0; i < submissions.length; i++) {
    const sub = submissions[i];
    const result = dayResult.submissionResults[i];

    emit(
      'SUBMISSION_RECEIVED',
      {
        blockId: sub.blockId,
        contributorId: sub.contributorId,
        blockType: sub.blockType,
        resourceUsage: sub.resourceUsage,
        difficultyMultiplier: sub.difficultyMultiplier,
        validationPassed: sub.validationPassed,
      },
      sub.contributorId
    );

    if (result) {
      const processedPayload: Record<string, unknown> = {
        blockId: result.blockId,
        contributorId: result.contributorId,
        accepted: true,
        isCanary: result.canaryDetected,
        canaryCorrect: result.canaryPassed,
        penaltyApplied: result.penaltyApplied,
      };

      emit('SUBMISSION_PROCESSED', processedPayload, result.contributorId);

      // Canary outcome events
      if (result.canaryDetected) {
        if (result.canaryPassed) {
          const contributor = dayResult.updatedContributors.get(result.contributorId);
          emit(
            'CANARY_PASSED',
            {
              blockId: result.blockId,
              contributorId: result.contributorId,
              newCanaryPasses: contributor?.canaryPasses ?? 0,
            },
            result.contributorId
          );
        } else {
          const contributor = dayResult.updatedContributors.get(result.contributorId);
          emit(
            'CANARY_FAILED',
            {
              blockId: result.blockId,
              contributorId: result.contributorId,
              newCanaryFailures: contributor?.canaryFailures ?? 0,
              newReputation: contributor?.reputationMultiplier ?? 0,
              lastCanaryFailureTime: contributor?.lastCanaryFailureTime?.toISOString(),
            },
            result.contributorId
          );
        }
      }
    }
  }

  // 4. DAY_FINALIZED
  const sortedRewards = [...dayResult.rewardDistribution.rewards].sort(
    (a, b) => (a.accountId < b.accountId ? -1 : 1)
  );
  emit('DAY_FINALIZED', {
    rewards: sortedRewards.map(r => ({
      accountId: r.accountId,
      totalReward: r.totalReward,
      basePoolReward: r.basePoolReward,
      performancePoolReward: r.performancePoolReward,
    })),
    totalEmissions: dayResult.rewardDistribution.totalEmissions,
    basePoolTotal: dayResult.rewardDistribution.basePoolTotal,
    performancePoolTotal: dayResult.rewardDistribution.performancePoolTotal,
    activeCount: dayResult.rewardDistribution.activeContributorCount,
  });

  // 5. REWARDS_COMMITTED
  const rewardHash = computeRewardHash(sortedRewards);
  emit('REWARDS_COMMITTED', {
    rewardHash,
    verificationValid: dayResult.verification.valid,
    lastEventHash: prevHash,
  });

  return events;
}

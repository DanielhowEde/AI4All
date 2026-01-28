import { DomainEvent } from './eventTypes';
import {
  NetworkState,
  createEmptyNetworkState,
} from '../services/serviceTypes';
import { Contributor, CompletedBlock, BlockType } from '../types';

/**
 * Apply a single domain event to a state, returning the new state.
 * This is a pure reducer that applies deltas from events.
 * It NEVER re-runs validation logic — events carry decision outputs.
 */
export function applyEvent(state: NetworkState, event: DomainEvent): NetworkState {
  switch (event.eventType) {
    case 'NODE_REGISTERED':
      return applyNodeRegistered(state, event);
    case 'WORK_ASSIGNED':
      // Assignments are external, no state change
      return state;
    case 'CANARIES_SELECTED':
      return applyCanariesSelected(state, event);
    case 'SUBMISSION_RECEIVED':
      // Raw input only; SUBMISSION_PROCESSED follows with decisions
      return state;
    case 'SUBMISSION_PROCESSED':
      return applySubmissionProcessed(state, event);
    case 'CANARY_PASSED':
      return applyCanaryPassed(state, event);
    case 'CANARY_FAILED':
      return applyCanaryFailed(state, event);
    case 'DAY_FINALIZED':
      // Rewards are output, not state
      return state;
    case 'REWARDS_COMMITTED':
      return applyRewardsCommitted(state, event);
    default:
      return state;
  }
}

function applyNodeRegistered(state: NetworkState, event: DomainEvent): NetworkState {
  const payload = event.payload as {
    accountId: string;
    initialReputation: number;
  };

  const contributor: Contributor = {
    accountId: payload.accountId,
    completedBlocks: [],
    reputationMultiplier: payload.initialReputation ?? 1.0,
    canaryFailures: 0,
    canaryPasses: 0,
  };

  const newContributors = new Map(state.contributors);
  newContributors.set(payload.accountId, contributor);

  return { ...state, contributors: newContributors };
}

function applyCanariesSelected(state: NetworkState, event: DomainEvent): NetworkState {
  const payload = event.payload as { canaryBlockIds: string[] };
  return {
    ...state,
    canaryBlockIds: new Set(payload.canaryBlockIds),
  };
}

function applySubmissionProcessed(state: NetworkState, event: DomainEvent): NetworkState {
  const payload = event.payload as {
    contributorId: string;
    blockId: string;
    accepted: boolean;
    isCanary: boolean;
    blockType?: BlockType;
    resourceUsage?: number;
    difficultyMultiplier?: number;
    validationPassed?: boolean;
    canaryCorrect?: boolean;
  };

  if (!payload.accepted) return state;

  const contributor = state.contributors.get(payload.contributorId);
  if (!contributor) return state;

  const block: CompletedBlock = {
    blockType: payload.blockType ?? BlockType.INFERENCE,
    resourceUsage: payload.resourceUsage ?? 1.0,
    difficultyMultiplier: payload.difficultyMultiplier ?? 1.0,
    validationPassed: payload.validationPassed ?? true,
    timestamp: new Date(event.timestamp),
    isCanary: payload.isCanary,
    canaryAnswerCorrect: payload.canaryCorrect,
  };

  const updated: Contributor = {
    ...contributor,
    completedBlocks: [...contributor.completedBlocks, block],
  };

  const newContributors = new Map(state.contributors);
  newContributors.set(payload.contributorId, updated);

  return { ...state, contributors: newContributors };
}

function applyCanaryPassed(state: NetworkState, event: DomainEvent): NetworkState {
  const payload = event.payload as {
    contributorId: string;
    newCanaryPasses: number;
  };

  const contributor = state.contributors.get(payload.contributorId);
  if (!contributor) return state;

  const updated: Contributor = {
    ...contributor,
    canaryPasses: payload.newCanaryPasses,
  };

  const newContributors = new Map(state.contributors);
  newContributors.set(payload.contributorId, updated);

  return { ...state, contributors: newContributors };
}

function applyCanaryFailed(state: NetworkState, event: DomainEvent): NetworkState {
  const payload = event.payload as {
    contributorId: string;
    newCanaryFailures: number;
    newReputation: number;
    lastCanaryFailureTime?: string;
  };

  const contributor = state.contributors.get(payload.contributorId);
  if (!contributor) return state;

  const updated: Contributor = {
    ...contributor,
    canaryFailures: payload.newCanaryFailures,
    reputationMultiplier: payload.newReputation,
    lastCanaryFailureTime: payload.lastCanaryFailureTime
      ? new Date(payload.lastCanaryFailureTime)
      : undefined,
  };

  const newContributors = new Map(state.contributors);
  newContributors.set(payload.contributorId, updated);

  return { ...state, contributors: newContributors };
}

function applyRewardsCommitted(state: NetworkState, _event: DomainEvent): NetworkState {
  return {
    ...state,
    dayNumber: state.dayNumber + 1,
  };
}

/**
 * Project a full state from a sequence of events.
 * Optionally starts from an initial state (useful for replay from snapshot).
 */
export function projectState(
  events: DomainEvent[],
  initialState?: NetworkState
): NetworkState {
  let state = initialState ?? createEmptyNetworkState();
  for (const event of events) {
    state = applyEvent(state, event);
  }
  return state;
}

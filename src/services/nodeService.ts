import { Contributor, RewardConfig } from '../types';
import { isActiveContributor, isBlockedByRecentCanaryFailure } from '../computePoints';
import { NetworkState, NodeRegistration, AuditEntry } from './serviceTypes';

/**
 * Register a new node. Returns a new NetworkState with the node added.
 * Throws if accountId already exists.
 */
export function registerNode(
  state: NetworkState,
  registration: NodeRegistration,
  timestamp: Date
): { state: NetworkState; contributor: Contributor; audit: AuditEntry } {
  if (state.contributors.has(registration.accountId)) {
    throw new Error(`Node already registered: ${registration.accountId}`);
  }

  const contributor: Contributor = {
    accountId: registration.accountId,
    completedBlocks: [],
    reputationMultiplier: registration.initialReputation ?? 1.0,
    canaryFailures: 0,
    canaryPasses: 0,
  };

  const newContributors = new Map(state.contributors);
  newContributors.set(registration.accountId, contributor);

  const audit: AuditEntry = {
    timestamp,
    eventType: 'NODE_REGISTERED',
    accountId: registration.accountId,
    details: {
      initialReputation: contributor.reputationMultiplier,
    },
  };

  return {
    state: {
      ...state,
      contributors: newContributors,
      auditLog: [...state.auditLog, audit],
    },
    contributor,
    audit,
  };
}

/**
 * Update a node's reputation. Returns a new Contributor (no mutation).
 */
export function updateNodeStatus(
  contributor: Contributor,
  updates: { reputationMultiplier?: number }
): Contributor {
  return {
    ...contributor,
    ...(updates.reputationMultiplier !== undefined && {
      reputationMultiplier: updates.reputationMultiplier,
    }),
  };
}

/**
 * Look up a contributor by accountId.
 */
export function getNode(
  state: NetworkState,
  accountId: string
): Contributor | undefined {
  return state.contributors.get(accountId);
}

/**
 * Return all active contributors (delegates to existing isActiveContributor).
 */
export function listActiveNodes(
  state: NetworkState,
  config: RewardConfig,
  currentTime?: Date
): Contributor[] {
  return Array.from(state.contributors.values()).filter(c =>
    isActiveContributor(c, config, currentTime)
  );
}

/**
 * Return all contributors currently blocked by a recent canary failure.
 */
export function listBlockedNodes(
  state: NetworkState,
  config: RewardConfig,
  currentTime?: Date
): Contributor[] {
  return Array.from(state.contributors.values()).filter(c =>
    isBlockedByRecentCanaryFailure(c, config, currentTime)
  );
}

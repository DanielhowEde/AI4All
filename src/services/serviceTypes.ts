import {
  Contributor,
  BlockAssignment,
  BlockAssignmentConfig,
  RewardConfig,
  RewardDistribution,
  BlockType,
} from '../types';
import { CanaryConfig } from '../canaryGenerator';

// ---------------------------------------------------------------------------
// Immutable state container
// ---------------------------------------------------------------------------

export interface NetworkState {
  contributors: Map<string, Contributor>;
  canaryBlockIds: Set<string>;
  auditLog: AuditEntry[];
  dayNumber: number;
}

export function createEmptyNetworkState(): NetworkState {
  return {
    contributors: new Map(),
    canaryBlockIds: new Set(),
    auditLog: [],
    dayNumber: 0,
  };
}

// ---------------------------------------------------------------------------
// Node registration
// ---------------------------------------------------------------------------

export interface NodeRegistration {
  accountId: string;
  initialReputation?: number; // defaults to 1.0
}

// ---------------------------------------------------------------------------
// Block submission
// ---------------------------------------------------------------------------

export interface BlockSubmission {
  contributorId: string;
  blockId: string;
  blockType: BlockType;
  resourceUsage: number;
  difficultyMultiplier: number;
  validationPassed: boolean;
  canaryAnswerCorrect?: boolean;
  timestamp: Date;
  /** AI token usage from the inference provider (recorded for audit) */
  tokenUsage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface SubmissionResult {
  contributorId: string;
  blockId: string;
  canaryDetected: boolean;
  canaryPassed?: boolean;
  penaltyApplied: boolean;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export type AuditEventType =
  | 'NODE_REGISTERED'
  | 'BLOCKS_ASSIGNED'
  | 'CANARIES_INJECTED'
  | 'SUBMISSION_ACCEPTED'
  | 'CANARY_PASSED'
  | 'CANARY_FAILED'
  | 'REWARDS_DISTRIBUTED'
  | 'DISTRIBUTION_VERIFIED';

export interface AuditEntry {
  timestamp: Date;
  eventType: AuditEventType;
  accountId?: string;
  details: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Daily orchestration
// ---------------------------------------------------------------------------

export interface DayConfig {
  rewardConfig: RewardConfig;
  blockAssignmentConfig: BlockAssignmentConfig;
  canaryConfig: CanaryConfig;
  currentTime: Date;
  random?: () => number;
}

export interface DayResult {
  assignments: BlockAssignment[];
  canaryBlockIds: string[];
  submissionResults: SubmissionResult[];
  updatedContributors: Map<string, Contributor>;
  rewardDistribution: RewardDistribution;
  audit: AuditEntry[];
  verification: { valid: boolean; error?: string };
}

// ---------------------------------------------------------------------------
// Network health
// ---------------------------------------------------------------------------

export interface NetworkHealthStats {
  totalNodes: number;
  activeNodes: number;
  blockedNodes: number;
  totalCanaryFailures: number;
  totalCanaryPasses: number;
  avgReputation: number;
}

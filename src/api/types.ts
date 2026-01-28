import { BlockType } from '../types';

/**
 * Day lifecycle phases
 */
export type DayPhase = 'IDLE' | 'ACTIVE' | 'FINALIZING';

/**
 * Result for a single block submission (used for idempotency cache)
 */
export interface SubmissionResultItem {
  blockId: string;
  accepted: boolean;
  error?: string;
  canaryDetected?: boolean;
  canaryPassed?: boolean;
  penaltyApplied?: boolean;
}

// ============================================================================
// Node Registration
// ============================================================================

export interface RegisterNodeRequest {
  accountId: string;
}

export interface RegisterNodeResponse {
  success: boolean;
  accountId: string;
  nodeKey: string;
  message: string;
}

// ============================================================================
// Heartbeat
// ============================================================================

export interface HeartbeatRequest {
  accountId: string;
  nodeKey: string;
}

export interface HeartbeatResponse {
  success: boolean;
  acknowledged: boolean;
}

// ============================================================================
// Day Start (Admin)
// ============================================================================

export interface DayStartRequest {
  dayId?: string; // Defaults to today UTC
}

export interface DayStartResponse {
  success: boolean;
  dayId: string;
  activeContributors: number;
  totalBlocks: number;
  seed: number;
  rosterHash: string;
}

// ============================================================================
// Day Status (Admin)
// ============================================================================

export interface DayStatusResponse {
  success: boolean;
  dayPhase: DayPhase;
  dayId: string | null;
  rosterSize: number;
  pendingSubmissionCount: number;
}

// ============================================================================
// Work Request
// ============================================================================

export interface WorkRequestRequest {
  accountId: string;
  nodeKey: string;
}

export interface WorkRequestResponse {
  success: boolean;
  dayId: string;
  assignments: Array<{ blockId: string; batchNumber: number }>;
  reason?: 'ROSTER_LOCKED' | 'NO_ASSIGNMENTS';
}

// ============================================================================
// Work Submit
// ============================================================================

export interface WorkSubmitRequest {
  accountId: string;
  nodeKey: string;
  dayId?: string; // Optional: rejected if != currentDayId
  submissions: Array<{
    blockId: string;
    blockType: BlockType;
    resourceUsage: number;
    difficultyMultiplier: number;
    validationPassed: boolean;
    canaryAnswerCorrect?: boolean;
  }>;
}

export interface WorkSubmitResponse {
  success: boolean;
  results: SubmissionResultItem[];
}

// ============================================================================
// Day Finalize (Admin)
// ============================================================================

export interface FinalizeResponse {
  success: boolean;
  dayId: string;
  verification: { valid: boolean; error?: string };
  summary: {
    activeContributors: number;
    totalEmissions: number;
    basePoolTotal: number;
    performancePoolTotal: number;
  };
}

// ============================================================================
// Rewards Query
// ============================================================================

export interface RewardsResponse {
  success: boolean;
  dayId: string;
  distribution: {
    totalEmissions: number;
    activeContributorCount: number;
    rewards: Array<{
      accountId: string;
      totalReward: number;
      basePoolReward: number;
      performancePoolReward: number;
    }>;
  };
}

// ============================================================================
// Error Response
// ============================================================================

export interface ErrorResponse {
  success: false;
  error: string;
  code: string;
}

// ============================================================================
// Error Codes
// ============================================================================

export const ErrorCodes = {
  MISSING_ACCOUNT_ID: 'MISSING_ACCOUNT_ID',
  DUPLICATE_NODE: 'DUPLICATE_NODE',
  NODE_NOT_FOUND: 'NODE_NOT_FOUND',
  INVALID_NODE_KEY: 'INVALID_NODE_KEY',
  MISSING_ADMIN_KEY: 'MISSING_ADMIN_KEY',
  INVALID_ADMIN_KEY: 'INVALID_ADMIN_KEY',
  DAY_NOT_STARTED: 'DAY_NOT_STARTED',
  DAY_ALREADY_ACTIVE: 'DAY_ALREADY_ACTIVE',
  DAY_FINALIZING: 'DAY_FINALIZING',
  DAY_MISMATCH: 'DAY_MISMATCH',
  NO_DISTRIBUTION_FOUND: 'NO_DISTRIBUTION_FOUND',
  NOT_ASSIGNED: 'NOT_ASSIGNED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

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
// Device Pairing
// ============================================================================

export type PairingStatus = 'PENDING' | 'APPROVED' | 'COMPLETED' | 'EXPIRED';

export interface DeviceCapabilities {
  gpuModel?: string;
  cpuCores?: number;
  ramGb?: number;
  os?: string;
}

export interface PairingSession {
  pairingId: string;
  pairingCode: string;         // K7F9-M2Q4 format (no I/O/0/1)
  verificationCode: string;    // 4-digit visual confirm
  status: PairingStatus;
  devicePublicKey: string;     // hex (ML-DSA-65, 3904 chars = 1952 bytes)
  deviceName: string;
  capabilities: DeviceCapabilities;
  createdAt: Date;
  expiresAt: Date;             // createdAt + 5 min
  approvedBy?: string;         // accountId of approving wallet
  challenge?: string;          // 32 random bytes hex, set on approve
}

export interface LinkedDevice {
  deviceId: string;
  accountId: string;
  devicePublicKey: string;     // hex
  deviceName: string;
  capabilities: DeviceCapabilities;
  linkedAt: string;            // ISO timestamp
}

// Pairing: Start (Worker → Server)
export interface PairingStartRequest {
  devicePublicKey: string;
  deviceName: string;
  capabilities?: DeviceCapabilities;
}

export interface PairingStartResponse {
  success: boolean;
  pairingId: string;
  pairingCode: string;
  verificationCode: string;
  expiresAt: string;           // ISO timestamp
}

// Pairing: Get Details (Phone → Server)
export interface PairingDetailsResponse {
  success: boolean;
  pairingId: string;
  status: PairingStatus;
  deviceName: string;
  capabilities: DeviceCapabilities;
  verificationCode: string;
  expiresAt: string;
}

// Pairing: Approve (Phone → Server)
export interface PairingApproveRequest {
  pairingId: string;
  accountId: string;
  walletPublicKey: string;     // hex — server verifies deriveAddress(pk) === accountId
  signature: string;           // hex — sign("AI4A:PAIR:APPROVE:v1" + pairingId + timestamp + nonce)
  timestamp: string;           // ISO timestamp
  nonce: string;
}

export interface PairingApproveResponse {
  success: boolean;
  status: PairingStatus;
}

// Pairing: Status (Worker polls)
export interface PairingStatusResponse {
  success: boolean;
  status: PairingStatus;
  challenge?: string;          // hex, present when APPROVED
  accountId?: string;          // present when APPROVED
}

// Pairing: Complete (Worker → Server)
export interface PairingCompleteRequest {
  pairingId: string;
  signature: string;           // hex — device signs challenge
}

export interface PairingCompleteResponse {
  success: boolean;
  deviceId: string;
  accountId: string;
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
  PAIRING_NOT_FOUND: 'PAIRING_NOT_FOUND',
  PAIRING_EXPIRED: 'PAIRING_EXPIRED',
  PAIRING_ALREADY_USED: 'PAIRING_ALREADY_USED',
  PAIRING_INVALID_STATE: 'PAIRING_INVALID_STATE',
  PAIRING_SIGNATURE_INVALID: 'PAIRING_SIGNATURE_INVALID',
  PAIRING_RATE_LIMITED: 'PAIRING_RATE_LIMITED',
  DEVICE_NOT_FOUND: 'DEVICE_NOT_FOUND',
  DEVICE_SIGNATURE_INVALID: 'DEVICE_SIGNATURE_INVALID',
  // Governance
  PERSONA_NOT_FOUND: 'PERSONA_NOT_FOUND',
  PERSONA_ALREADY_REGISTERED: 'PERSONA_ALREADY_REGISTERED',
  PROGRAMME_NOT_FOUND: 'PROGRAMME_NOT_FOUND',
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  MILESTONE_NOT_FOUND: 'MILESTONE_NOT_FOUND',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  NOT_AUTHORIZED: 'NOT_AUTHORIZED',
  INVALID_RECIPIENT: 'INVALID_RECIPIENT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

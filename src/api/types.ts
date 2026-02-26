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
  publicKey: string; // hex-encoded ML-DSA-65 public key (3904 chars = 1952 bytes)
}

export interface RegisterNodeResponse {
  success: boolean;
  accountId: string;
  message: string;
}

// ============================================================================
// Heartbeat
// ============================================================================

export interface HeartbeatRequest {
  accountId: string;
  timestamp: string;  // ISO-8601, ±30s window
  signature: string;  // hex-encoded ML-DSA-65 signature over "AI4ALL:v1:{accountId}:{timestamp}"
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
  timestamp: string;
  signature: string;
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
  timestamp: string;
  signature: string;
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
// Peer Discovery
// ============================================================================

export interface PeerInfo {
  workerId: string;
  accountId: string;
  listenAddr: string;         // "host:port" for direct TCP P2P
  capabilities: WorkerCapabilities;
  lastSeen: string;           // ISO timestamp
}

export interface WorkerCapabilities {
  supportedTasks: string[];
  maxConcurrentTasks: number;
  availableMemoryMb: number;
  gpuAvailable: boolean;
  gpuDevice?: string;
  gpuMemoryMb?: number;
  maxContextLength: number;
  workerVersion: string;
}

export interface PeerRegisterRequest {
  accountId: string;
  timestamp: string;
  signature: string;
  listenAddr: string;
  capabilities?: WorkerCapabilities;
}

export interface PeerRegisterResponse {
  success: boolean;
  workerId: string;
}

export interface PeerDirectoryResponse {
  success: boolean;
  peers: PeerInfo[];
}

// ============================================================================
// Work Groups
// ============================================================================

export type GroupPurposeType = 'MODEL_SHARD' | 'TASK_PIPELINE' | 'GENERAL';

export interface GroupMemberInfo {
  workerId: string;
  role: 'coordinator' | 'member';
  shardIndex?: number;
  pipelineStage?: number;
}

export interface WorkGroupInfo {
  groupId: string;
  purpose: GroupPurposeType;
  modelId?: string;
  totalShards?: number;
  pipelineId?: string;
  members: GroupMemberInfo[];
  createdAt: string;          // ISO timestamp
}

export interface GroupCreateRequest {
  purpose: GroupPurposeType;
  modelId?: string;
  workerIds: string[];        // Workers to include
}

export interface GroupCreateResponse {
  success: boolean;
  group: WorkGroupInfo;
}

export interface GroupListResponse {
  success: boolean;
  groups: WorkGroupInfo[];
}

// ============================================================================
// Error Codes
// ============================================================================

export const ErrorCodes = {
  MISSING_ACCOUNT_ID: 'MISSING_ACCOUNT_ID',
  DUPLICATE_NODE: 'DUPLICATE_NODE',
  NODE_NOT_FOUND: 'NODE_NOT_FOUND',
  INVALID_NODE_KEY: 'INVALID_NODE_KEY',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  MISSING_PUBLIC_KEY: 'MISSING_PUBLIC_KEY',
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
  PEER_NOT_FOUND: 'PEER_NOT_FOUND',
  PEER_ALREADY_REGISTERED: 'PEER_ALREADY_REGISTERED',
  GROUP_NOT_FOUND: 'GROUP_NOT_FOUND',
  GROUP_MEMBER_NOT_FOUND: 'GROUP_MEMBER_NOT_FOUND',
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  TASK_ALREADY_ASSIGNED: 'TASK_ALREADY_ASSIGNED',
  TASK_ALREADY_COMPLETED: 'TASK_ALREADY_COMPLETED',
  TASK_EXPIRED: 'TASK_EXPIRED',
  WORKER_NOT_REGISTERED: 'WORKER_NOT_REGISTERED',
  NO_PENDING_TASKS: 'NO_PENDING_TASKS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// ============================================================================
// On-Demand Task System
// ============================================================================

export type TaskStatus = 'PENDING' | 'ASSIGNED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'EXPIRED';

export type TaskPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';

export interface TaskGenerationParams {
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  seed?: number;
}

export interface TaskTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TaskRecord {
  taskId: string;
  clientId: string;
  status: TaskStatus;
  priority: TaskPriority;

  // Request payload
  prompt: string;
  systemPrompt?: string;
  model: string;
  params: TaskGenerationParams;

  // Assignment tracking
  assignedWorkerId?: string;
  assignedAt?: string;

  // Result
  output?: string;
  finishReason?: string;
  tokenUsage?: TaskTokenUsage;
  executionTimeMs?: number;
  error?: string;

  // Economic layer linkage
  blockId?: string;

  // Timestamps
  createdAt: string;
  completedAt?: string;
  expiresAt: string;
}

// Task: Submit (Client → Server)
export interface TaskSubmitRequest {
  clientId: string;
  prompt: string;
  systemPrompt?: string;
  model?: string;
  params?: TaskGenerationParams;
  priority?: TaskPriority;
}

export interface TaskSubmitResponse {
  success: boolean;
  taskId: string;
  status: TaskStatus;
  expiresAt: string;
}

// Task: Pending (Worker polls)
export interface TaskPendingResponse {
  success: boolean;
  tasks: Array<{
    taskId: string;
    prompt: string;
    systemPrompt?: string;
    model: string;
    params: TaskGenerationParams;
    priority: TaskPriority;
    createdAt: string;
    expiresAt: string;
  }>;
}

// Task: Complete (Worker → Server)
export interface TaskCompleteRequest {
  workerId: string;
  taskId: string;
  output: string;
  finishReason: string;
  tokenUsage?: TaskTokenUsage;
  executionTimeMs?: number;
  error?: string;
}

export interface TaskCompleteResponse {
  success: boolean;
  taskId: string;
  blockId?: string;
  /** Nanounits credited (1 AI token = 1 nanounit = 0.000000001 crypto tokens) */
  rewardNano?: string;
}

// Task: Result (Client retrieves)
export interface TaskResultResponse {
  success: boolean;
  task: TaskRecord;
}

// Task: List (Client lists their tasks)
export interface TaskListResponse {
  success: boolean;
  tasks: TaskRecord[];
}

// ============================================================================
// Data Ingest (Crawler → Coordinator)
// ============================================================================

export interface CrawledPageData {
  url: string;
  title?: string;
  text: string;
  embedding?: number[];
  fetchedAt: string;
  contentHash: string;
  workerAccountId?: string;
}

export interface DataIngestRequest {
  accountId: string;
  timestamp: string;
  signature: string;
  pages: CrawledPageData[];
}

export interface DataIngestResponse {
  success: boolean;
  accepted: number;
  reward: string;
}

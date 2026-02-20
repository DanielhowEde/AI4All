/**
 * AI4All Reward Distribution System - Core Types
 * v1.0
 */

/**
 * Types of AI blocks that can be completed
 */
export enum BlockType {
  INFERENCE = 'INFERENCE',
  EMBEDDINGS = 'EMBEDDINGS',
  VALIDATION = 'VALIDATION',
  TRAINING = 'TRAINING',
}

/**
 * Base points awarded for each block type
 */
export const BLOCK_TYPE_POINTS: Record<BlockType, number> = {
  [BlockType.INFERENCE]: 10,
  [BlockType.EMBEDDINGS]: 8,
  [BlockType.VALIDATION]: 5,
  [BlockType.TRAINING]: 15,
};

/**
 * Represents a completed AI block
 */
export interface CompletedBlock {
  blockType: BlockType;
  resourceUsage: number; // Normalized 0-1 (0 = minimal, 1 = maximal)
  difficultyMultiplier: number; // >= 1.0
  validationPassed: boolean;
  timestamp: Date;
  isCanary?: boolean; // True if this is a honeypot block for anti-gaming
  canaryAnswerCorrect?: boolean; // True if contributor answered canary correctly (only set if isCanary=true)
}

/**
 * Represents a contributor account
 */
export interface Contributor {
  accountId: string;
  completedBlocks: CompletedBlock[];
  reputationMultiplier: number; // 0-1, penalizes bad actors
  canaryFailures: number; // Count of failed canary blocks (for auditing)
  canaryPasses: number; // Count of passed canary blocks (for rehabilitation)
  lastCanaryFailureTime?: Date; // Timestamp of most recent canary failure (for 24h block)
  lastSeenAt?: Date; // Last successful heartbeat from this node
}

/**
 * Daily reward configuration
 */
export interface RewardConfig {
  dailyEmissions: number; // Total tokens to distribute per day
  basePoolPercentage: number; // 0-1, default 0.30
  performancePoolPercentage: number; // 0-1, default 0.70
  luckPoolPercentage?: number; // 0-1, optional, taken from performance pool
  minBlocksForActive: number; // Minimum blocks to be considered active
  minReliability: number; // Minimum reputation multiplier to qualify
  canaryFailurePenalty: number; // Reputation multiplier reduction per failed canary (e.g., 0.1 = -10% per failure)
  canaryBlockDurationMs: number; // Duration in milliseconds that contributor is blocked after failing a canary (default: 24h)
  performanceLookbackDays: number; // Days to look back for performance pool calculation (default: 30, aligns with block assignment)

  // Dynamic canary rate configuration
  baseCanaryPercentage: number; // Base canary rate for new/clean contributors (e.g., 0.10 = 10%)
  canaryIncreasePerFailure: number; // Increase canary rate per failure (e.g., 0.05 = +5% per failure)
  canaryDecreasePerPass: number; // Decrease canary rate per pass (e.g., 0.02 = -2% per pass)
  maxCanaryPercentage: number; // Maximum canary rate (e.g., 0.50 = 50% max)
  minCanaryPercentage: number; // Minimum canary rate (e.g., 0.05 = 5% min, for rehab)
}

/**
 * Reward allocation for a single contributor
 */
export interface ContributorReward {
  accountId: string;
  basePoolReward: number; // Tokens from base pool (equal distribution)
  performancePoolReward: number; // Tokens from performance pool (merit-based)
  luckPoolReward: number; // Tokens from luck pool (weighted lottery)
  totalReward: number; // Sum of all pools
  reason?: string; // Optional explanation of calculation
}

/**
 * Daily reward distribution result
 */
export interface RewardDistribution {
  date: Date; // Distribution date
  config: RewardConfig; // Configuration used
  totalEmissions: number; // Total tokens distributed
  basePoolTotal: number; // Base pool amount
  performancePoolTotal: number; // Performance pool amount
  luckPoolTotal: number; // Luck pool amount (if enabled)
  activeContributorCount: number; // Number of active contributors
  rewards: ContributorReward[]; // Individual rewards
}

/**
 * Block assignment for a contributor (batch of work to complete)
 */
export interface BlockAssignment {
  contributorId: string;
  blockIds: string[]; // Batch of block IDs assigned
  assignedAt: Date;
  batchNumber: number; // Which batch this is (1-440 per day if 2200 blocks / 5 per batch)
}

/**
 * Block assignment configuration
 */
export interface BlockAssignmentConfig {
  dailyBlockQuota: number; // Total blocks to distribute per day (default: 22,000)
  batchSize: number; // Blocks per batch (default: 5)
  performanceLookbackDays: number; // Days to look back for performance (default: 30)
  newContributorMinWeight: number; // Minimum weight for new contributors (default: 0.1)
}

/**
 * Default block assignment configuration
 */
export const DEFAULT_BLOCK_ASSIGNMENT_CONFIG: BlockAssignmentConfig = {
  dailyBlockQuota: 22_000,
  batchSize: 5,
  performanceLookbackDays: 30,
  newContributorMinWeight: 0.1,
};

/**
 * Default reward configuration per spec
 */
export const DEFAULT_REWARD_CONFIG: RewardConfig = {
  dailyEmissions: 22_000,
  basePoolPercentage: 0.20,
  performancePoolPercentage: 0.80,
  luckPoolPercentage: 0.0, // Optional, can be 0.05-0.10
  minBlocksForActive: 1,
  minReliability: 0.0, // Accept all for now, can raise to 0.5-0.8
  canaryFailurePenalty: 0.1, // -10% reputation per failed canary
  canaryBlockDurationMs: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
  performanceLookbackDays: 30, // 30-day rolling window (aligns with block assignment)

  // Dynamic canary rates (adaptive scrutiny)
  baseCanaryPercentage: 0.10, // 10% base rate for clean contributors
  canaryIncreasePerFailure: 0.05, // +5% per failure (escalating scrutiny)
  canaryDecreasePerPass: 0.02, // -2% per pass (rehabilitation)
  maxCanaryPercentage: 0.50, // 50% max (heavy cheaters get 1 in 2 blocks as canaries)
  minCanaryPercentage: 0.05, // 5% min (reformed contributors still monitored)
};

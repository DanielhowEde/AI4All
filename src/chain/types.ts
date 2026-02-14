/**
 * Dual-chain type definitions.
 *
 * Wallet Chain — per-wallet, permanent identity chain.
 *   Contains: wallet creation, device pairing, key rotation.
 *   Signed by wallet owner (ML-DSA-65).
 *
 * Transaction Chain — global, 30-day rolling window.
 *   Contains: work assignments, submissions, canary events, rewards.
 *   Each day produces one block with a reward Merkle root.
 */

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export const CHAIN_GENESIS_HASH = '0'.repeat(64);

export interface BlockHeader {
  blockHash: string;        // SHA-256 of the canonical block content
  prevBlockHash: string;    // Previous block in this chain
  blockNumber: number;      // Monotonically increasing
  timestamp: string;        // ISO-8601 creation time
}

// ---------------------------------------------------------------------------
// Wallet Chain (per wallet)
// ---------------------------------------------------------------------------

export type WalletEventType =
  | 'WALLET_CREATED'
  | 'DEVICE_PAIRED'
  | 'DEVICE_UNPAIRED'
  | 'PERSONA_REGISTERED';

export interface WalletEvent {
  eventType: WalletEventType;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface WalletBlock extends BlockHeader {
  chainType: 'wallet';
  walletAddress: string;      // ai4a... address that owns this chain
  publicKey: string;          // hex-encoded ML-DSA-65 public key
  events: WalletEvent[];
  eventsMerkleRoot: string;   // Merkle root of events in this block
  signature: string;          // hex ML-DSA-65 signature of blockHash by wallet key
}

// ---------------------------------------------------------------------------
// Transaction Chain (global, 30-day rolling)
// ---------------------------------------------------------------------------

export type TransactionEventType =
  | 'WORK_ASSIGNED'
  | 'CANARIES_SELECTED'
  | 'SUBMISSION_RECEIVED'
  | 'SUBMISSION_PROCESSED'
  | 'CANARY_PASSED'
  | 'CANARY_FAILED'
  | 'DAY_FINALIZED'
  | 'REWARDS_COMMITTED'
  | 'MILESTONE_COMPLETED'
  | 'MILESTONE_REWARD_ISSUED';

export interface TransactionEvent {
  eventType: TransactionEventType;
  actorId?: string;           // wallet address of the contributor
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface TransactionBlock extends BlockHeader {
  chainType: 'transaction';
  dayId: string;                 // YYYY-MM-DD this block covers
  events: TransactionEvent[];
  rewardMerkleRoot: string;      // Merkle root of reward distribution
  stateHash: string;             // SHA-256 of NetworkState after this block
  walletChainRef: string;        // Hash of latest wallet-chain block at time of creation
  contributorCount: number;
  totalEmissionsMicro: string;   // bigint as string
}

// ---------------------------------------------------------------------------
// Cross-chain reference
// ---------------------------------------------------------------------------

export interface ChainStatus {
  walletChainLength: number;
  transactionChainLength: number;
  latestTransactionBlockHash: string;
  latestTransactionDayId: string;
  oldestTransactionDayId: string;
  rollingWindowDays: number;
}

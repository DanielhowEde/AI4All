/**
 * Chain builder — constructs WalletBlocks and TransactionBlocks
 * from domain events, computes hashes, and manages chain linkage.
 */

import { canonicalStringify, computeHash } from '../persistence/canonicalSerialize';
import { computeMerkleRoot } from '../merkle';
import {
  CHAIN_GENESIS_HASH,
  WalletBlock,
  WalletEvent,
  TransactionBlock,
  TransactionEvent,
} from './types';

// ---------------------------------------------------------------------------
// Block hash computation
// ---------------------------------------------------------------------------

/** Compute the hash for a wallet block (excludes blockHash and signature) */
export function computeWalletBlockHash(
  block: Omit<WalletBlock, 'blockHash' | 'signature'>
): string {
  const hashInput = canonicalStringify({
    chainType: block.chainType,
    prevBlockHash: block.prevBlockHash,
    blockNumber: block.blockNumber,
    timestamp: block.timestamp,
    walletAddress: block.walletAddress,
    publicKey: block.publicKey,
    eventsMerkleRoot: block.eventsMerkleRoot,
  });
  return computeHash(hashInput);
}

/** Compute the hash for a transaction block (excludes blockHash) */
export function computeTransactionBlockHash(
  block: Omit<TransactionBlock, 'blockHash'>
): string {
  const hashInput = canonicalStringify({
    chainType: block.chainType,
    prevBlockHash: block.prevBlockHash,
    blockNumber: block.blockNumber,
    timestamp: block.timestamp,
    dayId: block.dayId,
    rewardMerkleRoot: block.rewardMerkleRoot,
    stateHash: block.stateHash,
    walletChainRef: block.walletChainRef,
    contributorCount: block.contributorCount,
    totalEmissionsMicro: block.totalEmissionsMicro,
  });
  return computeHash(hashInput);
}

// ---------------------------------------------------------------------------
// Wallet chain builder
// ---------------------------------------------------------------------------

/**
 * Build a wallet chain block for a new wallet or wallet event.
 * Returns the block without a signature — caller must sign blockHash.
 */
export function buildWalletBlock(opts: {
  walletAddress: string;
  publicKey: string;
  events: WalletEvent[];
  prevBlockHash?: string;
  blockNumber?: number;
}): Omit<WalletBlock, 'signature'> {
  const prevHash = opts.prevBlockHash ?? CHAIN_GENESIS_HASH;
  const blockNum = opts.blockNumber ?? 0;

  // Compute Merkle root of event payloads
  const eventLeaves = opts.events.map(e =>
    canonicalStringify({ eventType: e.eventType, timestamp: e.timestamp, payload: e.payload })
  );
  const eventsMerkleRoot = eventLeaves.length > 0
    ? computeMerkleRoot(eventLeaves)
    : computeHash('EMPTY_WALLET_BLOCK');

  const partial = {
    chainType: 'wallet' as const,
    prevBlockHash: prevHash,
    blockNumber: blockNum,
    timestamp: new Date().toISOString(),
    walletAddress: opts.walletAddress,
    publicKey: opts.publicKey,
    events: opts.events,
    eventsMerkleRoot,
  };

  const blockHash = computeWalletBlockHash(partial);

  return { ...partial, blockHash };
}

// ---------------------------------------------------------------------------
// Transaction chain builder
// ---------------------------------------------------------------------------

/**
 * Build a transaction block for a finalized day.
 * The block captures all work/reward events plus the reward Merkle root.
 */
export function buildTransactionBlock(opts: {
  dayId: string;
  events: TransactionEvent[];
  rewardMerkleRoot: string;
  stateHash: string;
  walletChainRef?: string;
  contributorCount: number;
  totalEmissionsMicro: bigint;
  prevBlockHash?: string;
  blockNumber?: number;
}): TransactionBlock {
  const prevHash = opts.prevBlockHash ?? CHAIN_GENESIS_HASH;
  const blockNum = opts.blockNumber ?? 0;

  const partial = {
    chainType: 'transaction' as const,
    prevBlockHash: prevHash,
    blockNumber: blockNum,
    timestamp: new Date().toISOString(),
    dayId: opts.dayId,
    events: opts.events,
    rewardMerkleRoot: opts.rewardMerkleRoot,
    stateHash: opts.stateHash,
    walletChainRef: opts.walletChainRef ?? CHAIN_GENESIS_HASH,
    contributorCount: opts.contributorCount,
    totalEmissionsMicro: opts.totalEmissionsMicro.toString(),
  };

  const blockHash = computeTransactionBlockHash(partial);

  return { ...partial, blockHash };
}

// ---------------------------------------------------------------------------
// Chain verification
// ---------------------------------------------------------------------------

/** Verify hash integrity of a wallet block */
export function verifyWalletBlock(block: WalletBlock): boolean {
  const { blockHash: claimed, signature: _, ...rest } = block;
  const computed = computeWalletBlockHash(rest as Omit<WalletBlock, 'blockHash' | 'signature'>);
  return computed === claimed;
}

/** Verify hash integrity of a transaction block */
export function verifyTransactionBlock(block: TransactionBlock): boolean {
  const { blockHash: claimed, ...rest } = block;
  const computed = computeTransactionBlockHash(rest);
  return computed === claimed;
}

/** Verify a chain of transaction blocks is properly linked */
export function verifyTransactionChain(blocks: TransactionBlock[]): {
  valid: boolean;
  error?: string;
} {
  if (blocks.length === 0) return { valid: true };

  // Sort by block number
  const sorted = [...blocks].sort((a, b) => a.blockNumber - b.blockNumber);

  // First block must reference genesis
  if (sorted[0].prevBlockHash !== CHAIN_GENESIS_HASH) {
    return { valid: false, error: `Block 0 does not reference genesis hash` };
  }

  for (let i = 0; i < sorted.length; i++) {
    // Verify block hash
    if (!verifyTransactionBlock(sorted[i])) {
      return { valid: false, error: `Block ${sorted[i].blockNumber} has invalid hash` };
    }

    // Verify chain linkage
    if (i > 0 && sorted[i].prevBlockHash !== sorted[i - 1].blockHash) {
      return {
        valid: false,
        error: `Block ${sorted[i].blockNumber} does not link to block ${sorted[i - 1].blockNumber}`,
      };
    }
  }

  return { valid: true };
}

/**
 * SQLite store for the dual-chain system.
 * Wallet chain: per-wallet identity blocks.
 * Transaction chain: global 30-day rolling window of daily blocks.
 */

import type Database from 'better-sqlite3';
import type { WalletBlock, TransactionBlock } from '../../chain/types';

export class SqliteChainStore {
  // Wallet chain statements
  private stmtInsertWallet: Database.Statement;
  private stmtGetWalletLatest: Database.Statement;
  private stmtGetWalletChain: Database.Statement;
  private stmtGetWalletBlock: Database.Statement;
  private stmtCountWalletBlocks: Database.Statement;

  // Transaction chain statements
  private stmtInsertTx: Database.Statement;
  private stmtGetTxLatest: Database.Statement;
  private stmtGetTxByDay: Database.Statement;
  private stmtGetTxBlock: Database.Statement;
  private stmtGetTxRange: Database.Statement;
  private stmtCountTxBlocks: Database.Statement;
  private stmtPruneTxBefore: Database.Statement;
  private stmtOldestTxDay: Database.Statement;

  constructor(db: Database.Database) {
    // -- Wallet chain --
    this.stmtInsertWallet = db.prepare(
      `INSERT INTO wallet_chain
       (block_hash, prev_block_hash, block_number, timestamp, wallet_address, public_key, events_json, events_merkle_root, signature)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    this.stmtGetWalletLatest = db.prepare(
      `SELECT * FROM wallet_chain WHERE wallet_address = ? ORDER BY block_number DESC LIMIT 1`
    );

    this.stmtGetWalletChain = db.prepare(
      `SELECT * FROM wallet_chain WHERE wallet_address = ? ORDER BY block_number ASC`
    );

    this.stmtGetWalletBlock = db.prepare(
      `SELECT * FROM wallet_chain WHERE block_hash = ?`
    );

    this.stmtCountWalletBlocks = db.prepare(
      `SELECT COUNT(*) as count FROM wallet_chain`
    );

    // -- Transaction chain --
    this.stmtInsertTx = db.prepare(
      `INSERT OR IGNORE INTO transaction_chain
       (block_hash, prev_block_hash, block_number, timestamp, day_id, events_json, reward_merkle_root, state_hash, wallet_chain_ref, contributor_count, total_emissions_micro)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    this.stmtGetTxLatest = db.prepare(
      `SELECT * FROM transaction_chain ORDER BY block_number DESC LIMIT 1`
    );

    this.stmtGetTxByDay = db.prepare(
      `SELECT * FROM transaction_chain WHERE day_id = ?`
    );

    this.stmtGetTxBlock = db.prepare(
      `SELECT * FROM transaction_chain WHERE block_hash = ?`
    );

    this.stmtGetTxRange = db.prepare(
      `SELECT * FROM transaction_chain WHERE day_id >= ? AND day_id <= ? ORDER BY block_number ASC`
    );

    this.stmtCountTxBlocks = db.prepare(
      `SELECT COUNT(*) as count FROM transaction_chain`
    );

    this.stmtPruneTxBefore = db.prepare(
      `DELETE FROM transaction_chain WHERE day_id < ?`
    );

    this.stmtOldestTxDay = db.prepare(
      `SELECT day_id FROM transaction_chain ORDER BY block_number ASC LIMIT 1`
    );
  }

  // =========================================================================
  // Wallet chain
  // =========================================================================

  appendWalletBlock(block: WalletBlock): void {
    this.stmtInsertWallet.run(
      block.blockHash,
      block.prevBlockHash,
      block.blockNumber,
      block.timestamp,
      block.walletAddress,
      block.publicKey,
      JSON.stringify(block.events),
      block.eventsMerkleRoot,
      block.signature,
    );
  }

  getLatestWalletBlock(walletAddress: string): WalletBlock | null {
    const row = this.stmtGetWalletLatest.get(walletAddress) as WalletRow | undefined;
    return row ? toWalletBlock(row) : null;
  }

  getWalletChain(walletAddress: string): WalletBlock[] {
    const rows = this.stmtGetWalletChain.all(walletAddress) as WalletRow[];
    return rows.map(toWalletBlock);
  }

  getWalletBlock(blockHash: string): WalletBlock | null {
    const row = this.stmtGetWalletBlock.get(blockHash) as WalletRow | undefined;
    return row ? toWalletBlock(row) : null;
  }

  getWalletChainLength(): number {
    return (this.stmtCountWalletBlocks.get() as { count: number }).count;
  }

  // =========================================================================
  // Transaction chain
  // =========================================================================

  appendTransactionBlock(block: TransactionBlock): void {
    this.stmtInsertTx.run(
      block.blockHash,
      block.prevBlockHash,
      block.blockNumber,
      block.timestamp,
      block.dayId,
      JSON.stringify(block.events),
      block.rewardMerkleRoot,
      block.stateHash,
      block.walletChainRef,
      block.contributorCount,
      block.totalEmissionsMicro,
    );
  }

  getLatestTransactionBlock(): TransactionBlock | null {
    const row = this.stmtGetTxLatest.get() as TxRow | undefined;
    return row ? toTransactionBlock(row) : null;
  }

  getTransactionBlockByDay(dayId: string): TransactionBlock | null {
    const row = this.stmtGetTxByDay.get(dayId) as TxRow | undefined;
    return row ? toTransactionBlock(row) : null;
  }

  getTransactionBlock(blockHash: string): TransactionBlock | null {
    const row = this.stmtGetTxBlock.get(blockHash) as TxRow | undefined;
    return row ? toTransactionBlock(row) : null;
  }

  getTransactionRange(fromDayId: string, toDayId: string): TransactionBlock[] {
    const rows = this.stmtGetTxRange.all(fromDayId, toDayId) as TxRow[];
    return rows.map(toTransactionBlock);
  }

  getTransactionChainLength(): number {
    return (this.stmtCountTxBlocks.get() as { count: number }).count;
  }

  getOldestTransactionDay(): string | null {
    const row = this.stmtOldestTxDay.get() as { day_id: string } | undefined;
    return row?.day_id ?? null;
  }

  /** Prune transaction blocks older than the given dayId (30-day rolling window) */
  pruneTransactionsBefore(dayId: string): number {
    const result = this.stmtPruneTxBefore.run(dayId);
    return result.changes;
  }
}

// ---------------------------------------------------------------------------
// Row types and mappers
// ---------------------------------------------------------------------------

interface WalletRow {
  block_hash: string;
  prev_block_hash: string;
  block_number: number;
  timestamp: string;
  wallet_address: string;
  public_key: string;
  events_json: string;
  events_merkle_root: string;
  signature: string;
}

function toWalletBlock(row: WalletRow): WalletBlock {
  return {
    chainType: 'wallet',
    blockHash: row.block_hash,
    prevBlockHash: row.prev_block_hash,
    blockNumber: row.block_number,
    timestamp: row.timestamp,
    walletAddress: row.wallet_address,
    publicKey: row.public_key,
    events: JSON.parse(row.events_json),
    eventsMerkleRoot: row.events_merkle_root,
    signature: row.signature,
  };
}

interface TxRow {
  block_hash: string;
  prev_block_hash: string;
  block_number: number;
  timestamp: string;
  day_id: string;
  events_json: string;
  reward_merkle_root: string;
  state_hash: string;
  wallet_chain_ref: string;
  contributor_count: number;
  total_emissions_micro: string;
}

function toTransactionBlock(row: TxRow): TransactionBlock {
  return {
    chainType: 'transaction',
    blockHash: row.block_hash,
    prevBlockHash: row.prev_block_hash,
    blockNumber: row.block_number,
    timestamp: row.timestamp,
    dayId: row.day_id,
    events: JSON.parse(row.events_json),
    rewardMerkleRoot: row.reward_merkle_root,
    stateHash: row.state_hash,
    walletChainRef: row.wallet_chain_ref,
    contributorCount: row.contributor_count,
    totalEmissionsMicro: row.total_emissions_micro,
  };
}

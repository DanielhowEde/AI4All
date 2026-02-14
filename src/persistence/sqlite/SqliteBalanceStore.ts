/**
 * SQLite balance store — tracks accumulated token balances per account.
 * All amounts stored as TEXT-encoded bigint microunits (1 token = 1,000,000 microunits).
 */

import type Database from 'better-sqlite3';

export interface BalanceRow {
  accountId: string;
  balanceMicro: bigint;
  totalEarnedMicro: bigint;
  lastRewardDay: string | null;
  updatedAt: string;
}

export interface BalanceHistoryRow {
  accountId: string;
  dayId: string;
  amountMicro: bigint;
  balanceAfterMicro: bigint;
  entryType: string;
  timestamp: string;
}

export class SqliteBalanceStore {
  private stmtGet: Database.Statement;
  private stmtUpsert: Database.Statement;
  private stmtInsertHistory: Database.Statement;
  private stmtHistory: Database.Statement;
  private stmtLeaderboard: Database.Statement;
  private stmtAllBalances: Database.Statement;
  private stmtCheckDay: Database.Statement;

  constructor(db: Database.Database) {
    this.stmtGet = db.prepare(
      `SELECT account_id, balance_micro, total_earned_micro, last_reward_day, updated_at
       FROM balances WHERE account_id = ?`
    );

    this.stmtUpsert = db.prepare(
      `INSERT INTO balances (account_id, balance_micro, total_earned_micro, last_reward_day, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET
         balance_micro = ?,
         total_earned_micro = ?,
         last_reward_day = ?,
         updated_at = ?`
    );

    this.stmtInsertHistory = db.prepare(
      `INSERT INTO balance_history (account_id, day_id, amount_micro, balance_after_micro, entry_type, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    this.stmtHistory = db.prepare(
      `SELECT account_id, day_id, amount_micro, balance_after_micro, entry_type, timestamp
       FROM balance_history WHERE account_id = ? ORDER BY id DESC LIMIT ?`
    );

    // BigInt-safe leaderboard: sort by string length DESC then value DESC
    // (all values are non-negative, so longer string = larger number)
    this.stmtLeaderboard = db.prepare(
      `SELECT account_id, balance_micro, total_earned_micro, last_reward_day, updated_at
       FROM balances
       ORDER BY LENGTH(total_earned_micro) DESC, total_earned_micro DESC
       LIMIT ?`
    );

    // Fetch all balances for BigInt-safe summation in JS
    this.stmtAllBalances = db.prepare(
      `SELECT balance_micro FROM balances`
    );

    // Dedup check: has this day already been credited?
    this.stmtCheckDay = db.prepare(
      `SELECT COUNT(*) as count FROM balance_history WHERE day_id = ? LIMIT 1`
    );

    // Credit rewards transactionally
    this._creditRewardsTxn = db.transaction(
      (dayId: string, rewards: Array<{ accountId: string; amountMicro: bigint }>, timestamp: string) => {
        for (const r of rewards) {
          const existing = this.stmtGet.get(r.accountId) as { balance_micro: string; total_earned_micro: string } | undefined;
          const prevBalance = existing ? BigInt(existing.balance_micro) : 0n;
          const prevEarned = existing ? BigInt(existing.total_earned_micro) : 0n;
          const newBalance = prevBalance + r.amountMicro;
          const newEarned = prevEarned + r.amountMicro;

          const balStr = newBalance.toString();
          const earnStr = newEarned.toString();

          this.stmtUpsert.run(
            r.accountId, balStr, earnStr, dayId, timestamp,
            balStr, earnStr, dayId, timestamp
          );

          this.stmtInsertHistory.run(
            r.accountId, dayId, r.amountMicro.toString(), balStr, 'REWARD', timestamp
          );
        }
      }
    );
  }

  private _creditRewardsTxn: (
    dayId: string,
    rewards: Array<{ accountId: string; amountMicro: bigint }>,
    timestamp: string
  ) => void;

  /** Get balance for a single account */
  getBalance(accountId: string): BalanceRow | null {
    const row = this.stmtGet.get(accountId) as {
      account_id: string;
      balance_micro: string;
      total_earned_micro: string;
      last_reward_day: string | null;
      updated_at: string;
    } | undefined;

    if (!row) return null;

    return {
      accountId: row.account_id,
      balanceMicro: BigInt(row.balance_micro),
      totalEarnedMicro: BigInt(row.total_earned_micro),
      lastRewardDay: row.last_reward_day,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Credit rewards for a finalized day. Atomic and idempotent — rejects duplicate dayId.
   * @param dayId The day being finalized
   * @param rewards Array of { accountId, amountMicro } to credit
   * @returns true if credited, false if dayId already credited (idempotent)
   */
  creditRewards(dayId: string, rewards: Array<{ accountId: string; amountMicro: bigint }>): boolean {
    // Idempotency guard: prevent double-credit on retry
    const check = this.stmtCheckDay.get(dayId) as { count: number };
    if (check.count > 0) {
      return false;
    }
    const timestamp = new Date().toISOString();
    this._creditRewardsTxn(dayId, rewards, timestamp);
    return true;
  }

  /** Get reward history for an account */
  getHistory(accountId: string, limit = 30): BalanceHistoryRow[] {
    const rows = this.stmtHistory.all(accountId, limit) as Array<{
      account_id: string;
      day_id: string;
      amount_micro: string;
      balance_after_micro: string;
      entry_type: string;
      timestamp: string;
    }>;

    return rows.map(r => ({
      accountId: r.account_id,
      dayId: r.day_id,
      amountMicro: BigInt(r.amount_micro),
      balanceAfterMicro: BigInt(r.balance_after_micro),
      entryType: r.entry_type,
      timestamp: r.timestamp,
    }));
  }

  /** Top earners leaderboard */
  getLeaderboard(limit = 20): BalanceRow[] {
    const rows = this.stmtLeaderboard.all(limit) as Array<{
      account_id: string;
      balance_micro: string;
      total_earned_micro: string;
      last_reward_day: string | null;
      updated_at: string;
    }>;

    return rows.map(r => ({
      accountId: r.account_id,
      balanceMicro: BigInt(r.balance_micro),
      totalEarnedMicro: BigInt(r.total_earned_micro),
      lastRewardDay: r.last_reward_day,
      updatedAt: r.updated_at,
    }));
  }

  /** Total circulating supply in microunits (BigInt-safe summation) */
  getTotalSupply(): bigint {
    const rows = this.stmtAllBalances.all() as Array<{ balance_micro: string }>;
    return rows.reduce((sum, r) => sum + BigInt(r.balance_micro), 0n);
  }
}

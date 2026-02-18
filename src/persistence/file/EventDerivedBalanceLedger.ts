import { IEventStore, IBalanceLedger, BalanceRow, BalanceHistoryRow } from '../interfaces';
import { toNanoUnits } from '../../fixedPoint';

/**
 * Balance ledger that derives all balances from DAY_FINALIZED events.
 * No separate mutable database — balances are computed from the
 * tamper-evident event chain.
 */
export class EventDerivedBalanceLedger implements IBalanceLedger {
  private balances = new Map<string, {
    balanceMicro: bigint;
    totalEarnedMicro: bigint;
    lastRewardDay: string | null;
    updatedAt: string;
  }>();

  private history: BalanceHistoryRow[] = [];

  constructor(private eventStore: IEventStore) {}

  /**
   * Rebuild balance cache from all DAY_FINALIZED events.
   * Must be called after construction.
   */
  async rebuild(): Promise<void> {
    this.balances.clear();
    this.history = [];

    const finalizedEvents = await this.eventStore.queryByType('DAY_FINALIZED');
    finalizedEvents.sort((a, b) => a.dayId.localeCompare(b.dayId));

    for (const event of finalizedEvents) {
      const payload = event.payload as {
        rewards: Array<{ accountId: string; totalReward: number }>;
      };
      if (!payload.rewards) continue;

      for (const r of payload.rewards) {
        if (r.totalReward <= 0) continue;
        this.applyReward(event.dayId, r.accountId, toNanoUnits(r.totalReward), event.timestamp);
      }
    }

    // Sort history newest first for getHistory() queries
    this.history.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  private applyReward(dayId: string, accountId: string, amountMicro: bigint, timestamp: string): void {
    const existing = this.balances.get(accountId);
    const prevBalance = existing?.balanceMicro ?? 0n;
    const prevEarned = existing?.totalEarnedMicro ?? 0n;
    const newBalance = prevBalance + amountMicro;
    const newEarned = prevEarned + amountMicro;

    this.balances.set(accountId, {
      balanceMicro: newBalance,
      totalEarnedMicro: newEarned,
      lastRewardDay: dayId,
      updatedAt: timestamp,
    });

    this.history.push({
      accountId,
      dayId,
      amountMicro,
      balanceAfterMicro: newBalance,
      entryType: 'REWARD',
      timestamp,
    });
  }

  getBalance(accountId: string): BalanceRow | null {
    const entry = this.balances.get(accountId);
    if (!entry) return null;
    return {
      accountId,
      balanceMicro: entry.balanceMicro,
      totalEarnedMicro: entry.totalEarnedMicro,
      lastRewardDay: entry.lastRewardDay,
      updatedAt: entry.updatedAt,
    };
  }

  creditRewards(dayId: string, rewards: Array<{ accountId: string; amountMicro: bigint }>): void {
    const timestamp = new Date().toISOString();
    for (const r of rewards) {
      this.applyReward(dayId, r.accountId, r.amountMicro, timestamp);
    }
  }

  getHistory(accountId: string, limit = 30): BalanceHistoryRow[] {
    return this.history
      .filter(h => h.accountId === accountId)
      .slice(0, limit);
  }

  getLeaderboard(limit = 20): BalanceRow[] {
    return Array.from(this.balances.entries())
      .map(([accountId, entry]) => ({
        accountId,
        ...entry,
      }))
      .sort((a, b) => {
        if (b.totalEarnedMicro > a.totalEarnedMicro) return 1;
        if (b.totalEarnedMicro < a.totalEarnedMicro) return -1;
        return 0;
      })
      .slice(0, limit);
  }

  getTotalSupply(): bigint {
    let total = 0n;
    for (const entry of this.balances.values()) {
      total += entry.balanceMicro;
    }
    return total;
  }
}

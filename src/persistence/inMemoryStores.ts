import { DomainEvent, DomainEventType } from './eventTypes';
import {
  IEventStore,
  IStateStore,
  IAssignmentStore,
  ISubmissionStore,
  IOperationalStore,
  IBalanceLedger,
  StateSnapshot,
  DayLifecycleData,
  BalanceRow,
  BalanceHistoryRow,
} from './interfaces';
import { NetworkState, BlockSubmission } from '../services/serviceTypes';
import { BlockAssignment } from '../types';

export class InMemoryEventStore implements IEventStore {
  private events: DomainEvent[] = [];

  async append(events: DomainEvent[]): Promise<void> {
    this.events.push(...events);
  }

  async queryByDay(dayId: string): Promise<DomainEvent[]> {
    return this.events.filter(e => e.dayId === dayId);
  }

  async queryByActor(
    actorId: string,
    dayRange?: { from: string; to: string }
  ): Promise<DomainEvent[]> {
    return this.events.filter(e => {
      if (e.actorId !== actorId) return false;
      if (dayRange) {
        if (e.dayId < dayRange.from || e.dayId > dayRange.to) return false;
      }
      return true;
    });
  }

  async queryByType(
    eventType: DomainEventType,
    dayRange?: { from: string; to: string }
  ): Promise<DomainEvent[]> {
    return this.events.filter(e => {
      if (e.eventType !== eventType) return false;
      if (dayRange) {
        if (e.dayId < dayRange.from || e.dayId > dayRange.to) return false;
      }
      return true;
    });
  }

  async getLastEvent(): Promise<DomainEvent | undefined> {
    return this.events.length > 0 ? this.events[this.events.length - 1] : undefined;
  }

  async getLastEventForDay(dayId: string): Promise<DomainEvent | undefined> {
    const dayEvents = await this.queryByDay(dayId);
    return dayEvents.length > 0 ? dayEvents[dayEvents.length - 1] : undefined;
  }

  getAllEvents(): DomainEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }
}

export class InMemoryStateStore implements IStateStore {
  private snapshots = new Map<string, StateSnapshot>();
  private states = new Map<string, NetworkState>();

  async saveSnapshot(snapshot: StateSnapshot): Promise<void> {
    this.snapshots.set(snapshot.dayId, snapshot);
  }

  async loadSnapshot(dayId: string): Promise<StateSnapshot | undefined> {
    return this.snapshots.get(dayId);
  }

  async loadLatestSnapshot(): Promise<StateSnapshot | undefined> {
    if (this.snapshots.size === 0) return undefined;
    const sorted = [...this.snapshots.values()].sort((a, b) =>
      b.dayId.localeCompare(a.dayId)
    );
    return sorted[0];
  }

  async saveState(dayId: string, state: NetworkState): Promise<void> {
    this.states.set(dayId, state);
  }

  async loadState(dayId: string): Promise<NetworkState | undefined> {
    return this.states.get(dayId);
  }

  clear(): void {
    this.snapshots.clear();
    this.states.clear();
  }
}

export class InMemoryAssignmentStore implements IAssignmentStore {
  private assignments = new Map<string, BlockAssignment[]>();

  async putAssignments(dayId: string, assignments: BlockAssignment[]): Promise<void> {
    this.assignments.set(dayId, assignments);
  }

  async getByNode(dayId: string, nodeId: string): Promise<BlockAssignment[]> {
    const dayAssignments = this.assignments.get(dayId) ?? [];
    return dayAssignments.filter(a => a.contributorId === nodeId);
  }

  async getByDay(dayId: string): Promise<BlockAssignment[]> {
    return this.assignments.get(dayId) ?? [];
  }

  clear(): void {
    this.assignments.clear();
  }
}

export class InMemorySubmissionStore implements ISubmissionStore {
  private submissions = new Map<string, BlockSubmission[]>();

  async putSubmissions(dayId: string, submissions: BlockSubmission[]): Promise<void> {
    this.submissions.set(dayId, submissions);
  }

  async appendSubmission(dayId: string, submission: BlockSubmission): Promise<void> {
    const existing = this.submissions.get(dayId) ?? [];
    existing.push(submission);
    this.submissions.set(dayId, existing);
  }

  async listByDay(dayId: string): Promise<BlockSubmission[]> {
    return this.submissions.get(dayId) ?? [];
  }

  async listByNode(dayId: string, nodeId: string): Promise<BlockSubmission[]> {
    const daySubmissions = this.submissions.get(dayId) ?? [];
    return daySubmissions.filter(s => s.contributorId === nodeId);
  }

  clear(): void {
    this.submissions.clear();
  }
}

export class InMemoryOperationalStore implements IOperationalStore {
  private nodeKeys = new Map<string, string>();
  private devices = new Map<string, unknown>();
  private accountDevices = new Map<string, string[]>();
  private dayPhase: DayLifecycleData | undefined;

  saveNodeKeys(keys: Map<string, string>): void {
    this.nodeKeys = new Map(keys);
  }

  loadNodeKeys(): Map<string, string> {
    return new Map(this.nodeKeys);
  }

  saveDevices(d: Map<string, unknown>, ad: Map<string, string[]>): void {
    this.devices = new Map(d);
    this.accountDevices = new Map(ad);
  }

  loadDevices(): { devices: Map<string, unknown>; accountDevices: Map<string, string[]> } {
    return {
      devices: new Map(this.devices),
      accountDevices: new Map(this.accountDevices),
    };
  }

  saveDayPhase(data: DayLifecycleData): void {
    this.dayPhase = data;
  }

  loadDayPhase(): DayLifecycleData | undefined {
    return this.dayPhase;
  }

  clearDayPhase(): void {
    this.dayPhase = undefined;
  }

  clear(): void {
    this.nodeKeys.clear();
    this.devices.clear();
    this.accountDevices.clear();
    this.dayPhase = undefined;
  }
}

export class InMemoryBalanceLedger implements IBalanceLedger {
  private balances = new Map<string, {
    balanceMicro: bigint;
    totalEarnedMicro: bigint;
    lastRewardDay: string | null;
    updatedAt: string;
  }>();
  private history: BalanceHistoryRow[] = [];

  getBalance(accountId: string): BalanceRow | null {
    const entry = this.balances.get(accountId);
    if (!entry) return null;
    return { accountId, ...entry };
  }

  creditRewards(dayId: string, rewards: Array<{ accountId: string; amountMicro: bigint }>): void {
    const timestamp = new Date().toISOString();
    for (const r of rewards) {
      const existing = this.balances.get(r.accountId);
      const prevBalance = existing?.balanceMicro ?? 0n;
      const prevEarned = existing?.totalEarnedMicro ?? 0n;
      const newBalance = prevBalance + r.amountMicro;
      const newEarned = prevEarned + r.amountMicro;

      this.balances.set(r.accountId, {
        balanceMicro: newBalance,
        totalEarnedMicro: newEarned,
        lastRewardDay: dayId,
        updatedAt: timestamp,
      });

      this.history.unshift({
        accountId: r.accountId,
        dayId,
        amountMicro: r.amountMicro,
        balanceAfterMicro: newBalance,
        entryType: 'REWARD',
        timestamp,
      });
    }
  }

  getHistory(accountId: string, limit = 30): BalanceHistoryRow[] {
    return this.history.filter(h => h.accountId === accountId).slice(0, limit);
  }

  getLeaderboard(limit = 20): BalanceRow[] {
    return Array.from(this.balances.entries())
      .map(([accountId, entry]) => ({ accountId, ...entry }))
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

  clear(): void {
    this.balances.clear();
    this.history = [];
  }
}

export function createInMemoryStores(): {
  event: InMemoryEventStore;
  state: InMemoryStateStore;
  assignment: InMemoryAssignmentStore;
  submission: InMemorySubmissionStore;
} {
  return {
    event: new InMemoryEventStore(),
    state: new InMemoryStateStore(),
    assignment: new InMemoryAssignmentStore(),
    submission: new InMemorySubmissionStore(),
  };
}

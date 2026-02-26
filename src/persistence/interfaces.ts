import { DomainEvent, DomainEventType } from './eventTypes';
import { NetworkState, BlockSubmission } from '../services/serviceTypes';
import { BlockAssignment } from '../types';

export interface StateSnapshot {
  dayId: string;
  dayNumber: number;
  stateHash: string;
  lastEventHash: string;
  rewardHash: string;
  contributorCount: number;
  createdAt: string; // ISO string
}

export interface IEventStore {
  append(events: DomainEvent[]): Promise<void>;
  queryByDay(dayId: string): Promise<DomainEvent[]>;
  queryByActor(actorId: string, dayRange?: { from: string; to: string }): Promise<DomainEvent[]>;
  queryByType(eventType: DomainEventType, dayRange?: { from: string; to: string }): Promise<DomainEvent[]>;
  getLastEvent(): Promise<DomainEvent | undefined>;
  getLastEventForDay(dayId: string): Promise<DomainEvent | undefined>;
}

export interface IStateStore {
  saveSnapshot(snapshot: StateSnapshot): Promise<void>;
  loadSnapshot(dayId: string): Promise<StateSnapshot | undefined>;
  loadLatestSnapshot(): Promise<StateSnapshot | undefined>;
  saveState(dayId: string, state: NetworkState): Promise<void>;
  loadState(dayId: string): Promise<NetworkState | undefined>;
}

export interface IAssignmentStore {
  putAssignments(dayId: string, assignments: BlockAssignment[]): Promise<void>;
  getByNode(dayId: string, nodeId: string): Promise<BlockAssignment[]>;
  getByDay(dayId: string): Promise<BlockAssignment[]>;
}

export interface ISubmissionStore {
  putSubmissions(dayId: string, submissions: BlockSubmission[]): Promise<void>;
  appendSubmission?(dayId: string, submission: BlockSubmission): Promise<void>;
  listByDay(dayId: string): Promise<BlockSubmission[]>;
  listByNode(dayId: string, nodeId: string): Promise<BlockSubmission[]>;
}

// ── Operational Store (replaces SqliteKvStore) ──────────────────────

export interface DayLifecycleData {
  dayPhase: string;
  currentDayId: string | null;
  currentDaySeed: number | null;
  rosterAccountIds: string[];
  canaryBlockIds: string[];
}

export interface IOperationalStore {
  savePublicKeys(publicKeys: Map<string, string>): void;
  loadPublicKeys(): Map<string, string>;

  saveDevices(
    devices: Map<string, unknown>,
    accountDevices: Map<string, string[]>
  ): void;
  loadDevices(): {
    devices: Map<string, unknown>;
    accountDevices: Map<string, string[]>;
  };

  saveDayPhase(data: DayLifecycleData): void;
  loadDayPhase(): DayLifecycleData | undefined;
  clearDayPhase(): void;
}

// ── Balance Ledger (replaces SqliteBalanceStore) ────────────────────

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

export interface IBalanceLedger {
  getBalance(accountId: string): BalanceRow | null;
  creditRewards(dayId: string, rewards: Array<{ accountId: string; amountMicro: bigint }>): void;
  getHistory(accountId: string, limit?: number): BalanceHistoryRow[];
  getLeaderboard(limit?: number): BalanceRow[];
  getTotalSupply(): bigint;
}

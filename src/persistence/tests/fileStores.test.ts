import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileEventStore } from '../file/FileEventStore';
import { FileStateStore } from '../file/FileStateStore';
import { FileAssignmentStore } from '../file/FileAssignmentStore';
import { FileSubmissionStore } from '../file/FileSubmissionStore';
import { FileOperationalStore } from '../file/FileOperationalStore';
import { EventDerivedBalanceLedger } from '../file/EventDerivedBalanceLedger';
import { DomainEvent, GENESIS_HASH } from '../eventTypes';
import { StateSnapshot } from '../interfaces';
import { BlockAssignment, BlockType } from '../../types';
import { BlockSubmission } from '../../services/serviceTypes';

const baseTime = new Date('2026-01-28T12:00:00Z');

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ai4all-test-'));
}

function makeEvent(
  dayId: string,
  seq: number,
  eventType: DomainEvent['eventType'],
  actorId?: string,
  payload: Record<string, unknown> = {}
): DomainEvent {
  return {
    eventId: `evt-${dayId}-${seq}`,
    dayId,
    sequenceNumber: seq,
    timestamp: baseTime.toISOString(),
    eventType,
    actorId,
    payload,
    prevEventHash: seq === 0 ? GENESIS_HASH : `hash-${seq - 1}`,
    eventHash: `hash-${seq}`,
  };
}

// ── FileEventStore ───────────────────────────────────────────────────

describe('FileEventStore', () => {
  let dataDir: string;
  let store: FileEventStore;

  beforeEach(() => {
    dataDir = tmpDir();
    store = new FileEventStore(dataDir);
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates the events directory on construction', () => {
    expect(fs.existsSync(path.join(dataDir, 'events'))).toBe(true);
  });

  it('appends and reads events by day', async () => {
    await store.append([makeEvent('2026-01-28', 0, 'WORK_ASSIGNED')]);
    const result = await store.queryByDay('2026-01-28');
    expect(result).toHaveLength(1);
    expect(result[0].eventId).toBe('evt-2026-01-28-0');
  });

  it('returns empty array for unknown day', async () => {
    expect(await store.queryByDay('2026-01-99')).toEqual([]);
  });

  it('appends multiple events in one call', async () => {
    await store.append([
      makeEvent('2026-01-28', 0, 'WORK_ASSIGNED'),
      makeEvent('2026-01-28', 1, 'SUBMISSION_PROCESSED'),
      makeEvent('2026-01-28', 2, 'DAY_FINALIZED'),
    ]);
    const result = await store.queryByDay('2026-01-28');
    expect(result).toHaveLength(3);
    expect(result.map(e => e.sequenceNumber)).toEqual([0, 1, 2]);
  });

  it('appends across multiple calls (JSONL accumulates)', async () => {
    await store.append([makeEvent('2026-01-28', 0, 'WORK_ASSIGNED')]);
    await store.append([makeEvent('2026-01-28', 1, 'DAY_FINALIZED')]);
    const result = await store.queryByDay('2026-01-28');
    expect(result).toHaveLength(2);
  });

  it('separates events by day into distinct JSONL files', async () => {
    await store.append([
      makeEvent('2026-01-27', 0, 'DAY_FINALIZED'),
      makeEvent('2026-01-28', 0, 'WORK_ASSIGNED'),
    ]);
    expect(await store.queryByDay('2026-01-27')).toHaveLength(1);
    expect(await store.queryByDay('2026-01-28')).toHaveLength(1);
    // Two separate .jsonl files on disk
    const files = fs.readdirSync(path.join(dataDir, 'events'));
    expect(files).toContain('2026-01-27.jsonl');
    expect(files).toContain('2026-01-28.jsonl');
  });

  it('queries by actor across all days', async () => {
    await store.append([
      makeEvent('2026-01-27', 0, 'SUBMISSION_PROCESSED', 'alice'),
      makeEvent('2026-01-28', 0, 'SUBMISSION_PROCESSED', 'alice'),
      makeEvent('2026-01-28', 1, 'SUBMISSION_PROCESSED', 'bob'),
    ]);
    const aliceEvents = await store.queryByActor('alice');
    expect(aliceEvents).toHaveLength(2);
    aliceEvents.forEach(e => expect(e.actorId).toBe('alice'));
  });

  it('queries by actor with day range', async () => {
    await store.append([
      makeEvent('2026-01-26', 0, 'SUBMISSION_PROCESSED', 'alice'),
      makeEvent('2026-01-27', 0, 'SUBMISSION_PROCESSED', 'alice'),
      makeEvent('2026-01-28', 0, 'SUBMISSION_PROCESSED', 'alice'),
    ]);
    const ranged = await store.queryByActor('alice', {
      from: '2026-01-27',
      to: '2026-01-27',
    });
    expect(ranged).toHaveLength(1);
    expect(ranged[0].dayId).toBe('2026-01-27');
  });

  it('queries by event type across days', async () => {
    await store.append([
      makeEvent('2026-01-27', 0, 'WORK_ASSIGNED'),
      makeEvent('2026-01-28', 0, 'WORK_ASSIGNED'),
      makeEvent('2026-01-28', 1, 'DAY_FINALIZED'),
    ]);
    const finalized = await store.queryByType('DAY_FINALIZED');
    expect(finalized).toHaveLength(1);
    expect(finalized[0].eventType).toBe('DAY_FINALIZED');
  });

  it('queries by event type with day range', async () => {
    await store.append([
      makeEvent('2026-01-26', 0, 'DAY_FINALIZED'),
      makeEvent('2026-01-27', 0, 'DAY_FINALIZED'),
      makeEvent('2026-01-28', 0, 'DAY_FINALIZED'),
    ]);
    const ranged = await store.queryByType('DAY_FINALIZED', {
      from: '2026-01-27',
      to: '2026-01-28',
    });
    expect(ranged).toHaveLength(2);
  });

  it('gets last event overall (latest day, latest seq)', async () => {
    await store.append([
      makeEvent('2026-01-27', 0, 'WORK_ASSIGNED'),
      makeEvent('2026-01-28', 0, 'SUBMISSION_PROCESSED'),
      makeEvent('2026-01-28', 1, 'DAY_FINALIZED'),
    ]);
    const last = await store.getLastEvent();
    expect(last?.sequenceNumber).toBe(1);
    expect(last?.dayId).toBe('2026-01-28');
  });

  it('returns undefined from getLastEvent on empty store', async () => {
    expect(await store.getLastEvent()).toBeUndefined();
  });

  it('gets last event for a specific day', async () => {
    await store.append([
      makeEvent('2026-01-28', 0, 'WORK_ASSIGNED'),
      makeEvent('2026-01-28', 1, 'DAY_FINALIZED'),
    ]);
    const last = await store.getLastEventForDay('2026-01-28');
    expect(last?.sequenceNumber).toBe(1);
  });

  it('returns undefined for getLastEventForDay on unknown day', async () => {
    expect(await store.getLastEventForDay('2026-01-99')).toBeUndefined();
  });

  it('survives malformed JSONL lines (crash recovery)', async () => {
    // Write one valid event then manually corrupt the file
    await store.append([makeEvent('2026-01-28', 0, 'WORK_ASSIGNED')]);
    const filePath = path.join(dataDir, 'events', '2026-01-28.jsonl');
    fs.appendFileSync(filePath, 'THIS IS NOT JSON\n');
    await store.append([makeEvent('2026-01-28', 1, 'DAY_FINALIZED')]);

    // Should return 2 valid events, skipping the corrupt line
    const result = await store.queryByDay('2026-01-28');
    expect(result).toHaveLength(2);
  });

  it('persists events across store instances (data survives restart)', async () => {
    await store.append([makeEvent('2026-01-28', 0, 'WORK_ASSIGNED')]);

    // Create a new store pointing at the same directory
    const store2 = new FileEventStore(dataDir);
    const result = await store2.queryByDay('2026-01-28');
    expect(result).toHaveLength(1);
    expect(result[0].eventType).toBe('WORK_ASSIGNED');
  });
});

// ── FileStateStore ───────────────────────────────────────────────────

describe('FileStateStore', () => {
  let dataDir: string;
  let store: FileStateStore;

  beforeEach(() => {
    dataDir = tmpDir();
    store = new FileStateStore(dataDir);
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates the snapshots directory on construction', () => {
    expect(fs.existsSync(path.join(dataDir, 'snapshots'))).toBe(true);
  });

  const makeSnapshot = (dayId: string, dayNumber: number): StateSnapshot => ({
    dayId,
    dayNumber,
    stateHash: `hash-${dayId}`,
    lastEventHash: `event-hash-${dayId}`,
    rewardHash: `reward-hash-${dayId}`,
    contributorCount: 3,
    createdAt: baseTime.toISOString(),
  });

  it('saves and loads a snapshot by dayId', async () => {
    const snap = makeSnapshot('2026-01-28', 1);
    await store.saveSnapshot(snap);
    const loaded = await store.loadSnapshot('2026-01-28');
    expect(loaded).toEqual(snap);
  });

  it('returns undefined for unknown snapshot', async () => {
    expect(await store.loadSnapshot('2026-01-99')).toBeUndefined();
  });

  it('overwrites an existing snapshot for the same day', async () => {
    await store.saveSnapshot(makeSnapshot('2026-01-28', 1));
    const updated = { ...makeSnapshot('2026-01-28', 1), contributorCount: 99 };
    await store.saveSnapshot(updated);
    const loaded = await store.loadSnapshot('2026-01-28');
    expect(loaded?.contributorCount).toBe(99);
  });

  it('loads latest snapshot (lexically last day)', async () => {
    await store.saveSnapshot(makeSnapshot('2026-01-26', 1));
    await store.saveSnapshot(makeSnapshot('2026-01-28', 3));
    await store.saveSnapshot(makeSnapshot('2026-01-27', 2));
    const latest = await store.loadLatestSnapshot();
    expect(latest?.dayId).toBe('2026-01-28');
  });

  it('returns undefined from loadLatestSnapshot on empty dir', async () => {
    expect(await store.loadLatestSnapshot()).toBeUndefined();
  });

  it('persists snapshot across store instances', async () => {
    await store.saveSnapshot(makeSnapshot('2026-01-28', 1));
    const store2 = new FileStateStore(dataDir);
    const loaded = await store2.loadSnapshot('2026-01-28');
    expect(loaded?.dayNumber).toBe(1);
  });

  it('writes atomically via .tmp rename (no partial files)', async () => {
    // The tmp file should not be present after a successful write
    await store.saveSnapshot(makeSnapshot('2026-01-28', 1));
    const tmpFile = path.join(dataDir, 'snapshots', '2026-01-28.json.tmp');
    expect(fs.existsSync(tmpFile)).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'snapshots', '2026-01-28.json'))).toBe(true);
  });
});

// ── FileAssignmentStore ──────────────────────────────────────────────

describe('FileAssignmentStore', () => {
  let dataDir: string;
  let store: FileAssignmentStore;

  beforeEach(() => {
    dataDir = tmpDir();
    store = new FileAssignmentStore(dataDir);
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const assignments: BlockAssignment[] = [
    { contributorId: 'alice', blockIds: ['b1', 'b2'], assignedAt: baseTime, batchNumber: 1 },
    { contributorId: 'bob', blockIds: ['b3'], assignedAt: baseTime, batchNumber: 1 },
  ];

  it('puts and retrieves all assignments for a day', async () => {
    await store.putAssignments('2026-01-28', assignments);
    const result = await store.getByDay('2026-01-28');
    expect(result).toHaveLength(2);
  });

  it('returns empty for unknown day', async () => {
    expect(await store.getByDay('2026-01-99')).toEqual([]);
  });

  it('filters assignments by node', async () => {
    await store.putAssignments('2026-01-28', assignments);
    const alice = await store.getByNode('2026-01-28', 'alice');
    expect(alice).toHaveLength(1);
    expect(alice[0].blockIds).toEqual(['b1', 'b2']);
  });

  it('deserializes Date correctly from JSON', async () => {
    await store.putAssignments('2026-01-28', assignments);
    const result = await store.getByDay('2026-01-28');
    expect(result[0].assignedAt).toBeInstanceOf(Date);
    expect(result[0].assignedAt.toISOString()).toBe(baseTime.toISOString());
  });

  it('overwrites assignments on repeated put', async () => {
    await store.putAssignments('2026-01-28', assignments);
    await store.putAssignments('2026-01-28', [assignments[0]]); // only alice
    const result = await store.getByDay('2026-01-28');
    expect(result).toHaveLength(1);
  });

  it('persists across store instances', async () => {
    await store.putAssignments('2026-01-28', assignments);
    const store2 = new FileAssignmentStore(dataDir);
    const result = await store2.getByDay('2026-01-28');
    expect(result).toHaveLength(2);
  });
});

// ── FileSubmissionStore ──────────────────────────────────────────────

describe('FileSubmissionStore', () => {
  let dataDir: string;
  let store: FileSubmissionStore;

  beforeEach(() => {
    dataDir = tmpDir();
    store = new FileSubmissionStore(dataDir);
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const makeSubmission = (contributorId: string, blockId: string): BlockSubmission => ({
    contributorId,
    blockId,
    blockType: BlockType.INFERENCE,
    resourceUsage: 0.75,
    difficultyMultiplier: 1.0,
    validationPassed: true,
    timestamp: baseTime,
  });

  it('puts and lists submissions by day', async () => {
    await store.putSubmissions('2026-01-28', [
      makeSubmission('alice', 'b1'),
      makeSubmission('bob', 'b2'),
    ]);
    const result = await store.listByDay('2026-01-28');
    expect(result).toHaveLength(2);
  });

  it('returns empty for unknown day', async () => {
    expect(await store.listByDay('2026-01-99')).toEqual([]);
  });

  it('filters submissions by node', async () => {
    await store.putSubmissions('2026-01-28', [
      makeSubmission('alice', 'b1'),
      makeSubmission('bob', 'b2'),
    ]);
    const alice = await store.listByNode('2026-01-28', 'alice');
    expect(alice).toHaveLength(1);
    expect(alice[0].blockId).toBe('b1');
  });

  it('deserializes timestamp as Date', async () => {
    await store.putSubmissions('2026-01-28', [makeSubmission('alice', 'b1')]);
    const result = await store.listByDay('2026-01-28');
    expect(result[0].timestamp).toBeInstanceOf(Date);
    expect(result[0].timestamp.toISOString()).toBe(baseTime.toISOString());
  });

  it('appends a single submission without overwriting others', async () => {
    await store.putSubmissions('2026-01-28', [makeSubmission('alice', 'b1')]);
    await store.appendSubmission?.('2026-01-28', makeSubmission('bob', 'b2'));
    const result = await store.listByDay('2026-01-28');
    expect(result).toHaveLength(2);
    expect(result.map(s => s.blockId).sort()).toEqual(['b1', 'b2']);
  });

  it('persists across store instances', async () => {
    await store.putSubmissions('2026-01-28', [makeSubmission('alice', 'b1')]);
    const store2 = new FileSubmissionStore(dataDir);
    const result = await store2.listByDay('2026-01-28');
    expect(result).toHaveLength(1);
  });
});

// ── FileOperationalStore ─────────────────────────────────────────────

describe('FileOperationalStore', () => {
  let dataDir: string;
  let store: FileOperationalStore;

  beforeEach(() => {
    dataDir = tmpDir();
    store = new FileOperationalStore(dataDir);
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('saves and loads node keys', () => {
    const keys = new Map([['node-1', 'key-abc'], ['node-2', 'key-def']]);
    store.saveNodeKeys(keys);
    const loaded = store.loadNodeKeys();
    expect(loaded.get('node-1')).toBe('key-abc');
    expect(loaded.get('node-2')).toBe('key-def');
    expect(loaded.size).toBe(2);
  });

  it('returns empty map when no node keys saved', () => {
    expect(store.loadNodeKeys().size).toBe(0);
  });

  it('saves and loads devices', () => {
    const devices = new Map<string, unknown>([
      ['dev-1', { deviceId: 'dev-1', name: 'Phone' }],
    ]);
    const accountDevices = new Map([['acc-1', ['dev-1']]]);
    store.saveDevices(devices, accountDevices);

    const loaded = store.loadDevices();
    expect(loaded.devices.size).toBe(1);
    expect(loaded.accountDevices.get('acc-1')).toEqual(['dev-1']);
  });

  it('returns empty maps when no devices saved', () => {
    const loaded = store.loadDevices();
    expect(loaded.devices.size).toBe(0);
    expect(loaded.accountDevices.size).toBe(0);
  });

  it('saves and loads day phase', () => {
    const dayData = {
      dayPhase: 'ACTIVE',
      currentDayId: '2026-01-28',
      currentDaySeed: 42,
      rosterAccountIds: ['acc-1', 'acc-2'],
      canaryBlockIds: ['blk-1'],
    };
    store.saveDayPhase(dayData);
    const loaded = store.loadDayPhase();
    expect(loaded).toEqual(dayData);
  });

  it('returns undefined when no day phase saved', () => {
    expect(store.loadDayPhase()).toBeUndefined();
  });

  it('clears day phase', () => {
    store.saveDayPhase({
      dayPhase: 'ACTIVE',
      currentDayId: '2026-01-28',
      currentDaySeed: 42,
      rosterAccountIds: [],
      canaryBlockIds: [],
    });
    store.clearDayPhase();
    expect(store.loadDayPhase()).toBeUndefined();
  });

  it('partial writes are atomic — no corrupt operational.json', () => {
    const keys = new Map([['node-1', 'key']]);
    store.saveNodeKeys(keys);
    // Tmp file should be gone after successful write
    const tmpFile = path.join(dataDir, 'operational.json.tmp');
    expect(fs.existsSync(tmpFile)).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'operational.json'))).toBe(true);
  });

  it('fields are independent — saving node keys does not wipe day phase', () => {
    store.saveDayPhase({
      dayPhase: 'ACTIVE',
      currentDayId: '2026-01-28',
      currentDaySeed: 1,
      rosterAccountIds: [],
      canaryBlockIds: [],
    });
    store.saveNodeKeys(new Map([['n1', 'k1']]));
    // Day phase should still be there
    expect(store.loadDayPhase()?.dayPhase).toBe('ACTIVE');
    expect(store.loadNodeKeys().get('n1')).toBe('k1');
  });

  it('persists across store instances', () => {
    store.saveNodeKeys(new Map([['n1', 'key1']]));
    const store2 = new FileOperationalStore(dataDir);
    expect(store2.loadNodeKeys().get('n1')).toBe('key1');
  });
});

// ── EventDerivedBalanceLedger ─────────────────────────────────────────

describe('EventDerivedBalanceLedger', () => {
  let dataDir: string;
  let eventStore: FileEventStore;
  let ledger: EventDerivedBalanceLedger;

  beforeEach(async () => {
    dataDir = tmpDir();
    eventStore = new FileEventStore(dataDir);
    ledger = new EventDerivedBalanceLedger(eventStore);
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const makeFinalizedEvent = (
    dayId: string,
    rewards: Array<{ accountId: string; totalReward: number }>
  ): DomainEvent => ({
    eventId: `evt-${dayId}-finalized`,
    dayId,
    sequenceNumber: 99,
    timestamp: baseTime.toISOString(),
    eventType: 'DAY_FINALIZED',
    payload: { rewards },
    prevEventHash: GENESIS_HASH,
    eventHash: `hash-${dayId}`,
  });

  it('starts with empty balances before rebuild', () => {
    expect(ledger.getBalance('alice')).toBeNull();
    expect(ledger.getTotalSupply()).toBe(0n);
  });

  it('rebuilds balances from DAY_FINALIZED events', async () => {
    await eventStore.append([
      makeFinalizedEvent('2026-01-28', [
        { accountId: 'alice', totalReward: 1.0 }, // 1 token = 1_000_000_000 nanounits
        { accountId: 'bob', totalReward: 0.5 },
      ]),
    ]);

    await ledger.rebuild();

    const alice = ledger.getBalance('alice');
    expect(alice).not.toBeNull();
    expect(alice!.balanceMicro).toBe(1_000_000_000n);

    const bob = ledger.getBalance('bob');
    expect(bob!.balanceMicro).toBe(500_000_000n);
  });

  it('accumulates rewards across multiple finalized days', async () => {
    await eventStore.append([
      makeFinalizedEvent('2026-01-27', [{ accountId: 'alice', totalReward: 1.0 }]),
      makeFinalizedEvent('2026-01-28', [{ accountId: 'alice', totalReward: 2.0 }]),
    ]);

    await ledger.rebuild();

    const alice = ledger.getBalance('alice');
    expect(alice!.balanceMicro).toBe(3_000_000_000n);
    expect(alice!.totalEarnedMicro).toBe(3_000_000_000n);
    expect(alice!.lastRewardDay).toBe('2026-01-28');
  });

  it('ignores zero-reward entries during rebuild', async () => {
    await eventStore.append([
      makeFinalizedEvent('2026-01-28', [
        { accountId: 'alice', totalReward: 0 },
        { accountId: 'bob', totalReward: 1.0 },
      ]),
    ]);

    await ledger.rebuild();

    expect(ledger.getBalance('alice')).toBeNull(); // Skipped
    expect(ledger.getBalance('bob')!.balanceMicro).toBe(1_000_000_000n);
  });

  it('creditRewards adds to balance immediately (no rebuild needed)', async () => {
    await ledger.rebuild();

    ledger.creditRewards('2026-01-28', [
      { accountId: 'alice', amountMicro: 500n },
      { accountId: 'bob', amountMicro: 300n },
    ]);

    expect(ledger.getBalance('alice')!.balanceMicro).toBe(500n);
    expect(ledger.getBalance('bob')!.balanceMicro).toBe(300n);
  });

  it('creditRewards accumulates on top of rebuilt balances', async () => {
    await eventStore.append([
      makeFinalizedEvent('2026-01-28', [{ accountId: 'alice', totalReward: 1.0 }]),
    ]);
    await ledger.rebuild();

    // Direct credit after rebuild
    ledger.creditRewards('2026-01-28', [{ accountId: 'alice', amountMicro: 1000n }]);

    const alice = ledger.getBalance('alice');
    expect(alice!.balanceMicro).toBe(1_000_000_000n + 1000n);
  });

  it('getHistory returns credits for an account newest-first', async () => {
    // Use distinct timestamps so the sort-by-timestamp ordering is deterministic
    const older = new Date('2026-01-27T12:00:00Z').toISOString();
    const newer = new Date('2026-01-28T12:00:00Z').toISOString();
    await eventStore.append([
      { ...makeFinalizedEvent('2026-01-27', [{ accountId: 'alice', totalReward: 1.0 }]), timestamp: older },
      { ...makeFinalizedEvent('2026-01-28', [{ accountId: 'alice', totalReward: 2.0 }]), timestamp: newer },
    ]);
    await ledger.rebuild();

    const history = ledger.getHistory('alice');
    expect(history).toHaveLength(2);
    // Newest first: 2026-01-28 (newer timestamp) before 2026-01-27
    expect(history[0].dayId).toBe('2026-01-28');
    expect(history[1].dayId).toBe('2026-01-27');
  });

  it('getHistory respects limit', async () => {
    await eventStore.append([
      makeFinalizedEvent('2026-01-26', [{ accountId: 'alice', totalReward: 1.0 }]),
      makeFinalizedEvent('2026-01-27', [{ accountId: 'alice', totalReward: 1.0 }]),
      makeFinalizedEvent('2026-01-28', [{ accountId: 'alice', totalReward: 1.0 }]),
    ]);
    await ledger.rebuild();

    const history = ledger.getHistory('alice', 2);
    expect(history).toHaveLength(2);
  });

  it('getLeaderboard returns accounts sorted by totalEarned descending', async () => {
    await eventStore.append([
      makeFinalizedEvent('2026-01-28', [
        { accountId: 'alice', totalReward: 3.0 },
        { accountId: 'bob', totalReward: 5.0 },
        { accountId: 'carol', totalReward: 1.0 },
      ]),
    ]);
    await ledger.rebuild();

    const board = ledger.getLeaderboard(10);
    expect(board[0].accountId).toBe('bob');   // 5 tokens
    expect(board[1].accountId).toBe('alice'); // 3 tokens
    expect(board[2].accountId).toBe('carol'); // 1 token
  });

  it('getTotalSupply sums all balances', async () => {
    await eventStore.append([
      makeFinalizedEvent('2026-01-28', [
        { accountId: 'alice', totalReward: 1.0 },
        { accountId: 'bob', totalReward: 2.0 },
      ]),
    ]);
    await ledger.rebuild();

    expect(ledger.getTotalSupply()).toBe(3_000_000_000n);
  });

  it('rebuild is idempotent — calling twice gives same result', async () => {
    await eventStore.append([
      makeFinalizedEvent('2026-01-28', [{ accountId: 'alice', totalReward: 1.0 }]),
    ]);

    await ledger.rebuild();
    await ledger.rebuild();

    expect(ledger.getBalance('alice')!.balanceMicro).toBe(1_000_000_000n);
    expect(ledger.getTotalSupply()).toBe(1_000_000_000n);
  });
});

// ── E2E: data survives full process restart ───────────────────────────

describe('E2E: file persistence across restarts', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('events written by one store instance are read by a new instance', async () => {
    // === "Run 1" ===
    {
      const events = new FileEventStore(dataDir);
      const ops = new FileOperationalStore(dataDir);

      await events.append([makeEvent('2026-01-28', 0, 'NODE_REGISTERED', 'alice')]);
      await events.append([makeEvent('2026-01-28', 1, 'WORK_ASSIGNED', 'alice')]);
      ops.saveNodeKeys(new Map([['alice', 'nodekey-abc']]));
      ops.saveDayPhase({
        dayPhase: 'ACTIVE',
        currentDayId: '2026-01-28',
        currentDaySeed: 777,
        rosterAccountIds: ['alice'],
        canaryBlockIds: [],
      });
    }

    // === "Run 2" — simulate restart by creating new instances ===
    {
      const events = new FileEventStore(dataDir);
      const ops = new FileOperationalStore(dataDir);
      const ledger = new EventDerivedBalanceLedger(events);

      // Restore state
      const phase = ops.loadDayPhase();
      expect(phase?.dayPhase).toBe('ACTIVE');
      expect(phase?.currentDaySeed).toBe(777);

      const nodeKeys = ops.loadNodeKeys();
      expect(nodeKeys.get('alice')).toBe('nodekey-abc');

      const dayEvents = await events.queryByDay('2026-01-28');
      expect(dayEvents).toHaveLength(2);
      expect(dayEvents[0].eventType).toBe('NODE_REGISTERED');
      expect(dayEvents[1].eventType).toBe('WORK_ASSIGNED');

      // Append a finalized event and rebuild the ledger
      await events.append([
        {
          eventId: 'evt-final',
          dayId: '2026-01-28',
          sequenceNumber: 2,
          timestamp: baseTime.toISOString(),
          eventType: 'DAY_FINALIZED',
          actorId: undefined,
          payload: { rewards: [{ accountId: 'alice', totalReward: 10.0 }] },
          prevEventHash: 'hash-1',
          eventHash: 'hash-final',
        },
      ]);

      await ledger.rebuild();
      expect(ledger.getBalance('alice')!.balanceMicro).toBe(10_000_000_000n);
    }
  });
});

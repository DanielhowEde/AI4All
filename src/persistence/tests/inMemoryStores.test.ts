import {
  InMemoryEventStore,
  InMemoryStateStore,
  InMemoryAssignmentStore,
  InMemorySubmissionStore,
  createInMemoryStores,
} from '../inMemoryStores';
import { DomainEvent, GENESIS_HASH } from '../eventTypes';
import { createEmptyNetworkState, BlockSubmission } from '../../services/serviceTypes';
import { BlockAssignment, BlockType } from '../../types';

const baseTime = new Date('2026-01-28T12:00:00Z');

function makeEvent(
  dayId: string,
  seq: number,
  eventType: string,
  actorId?: string
): DomainEvent {
  return {
    eventId: `evt-${dayId}-${seq}`,
    dayId,
    sequenceNumber: seq,
    timestamp: baseTime.toISOString(),
    eventType: eventType as DomainEvent['eventType'],
    actorId,
    payload: {},
    prevEventHash: seq === 0 ? GENESIS_HASH : `hash-${seq - 1}`,
    eventHash: `hash-${seq}`,
  };
}

describe('InMemoryEventStore', () => {
  let store: InMemoryEventStore;

  beforeEach(() => {
    store = new InMemoryEventStore();
  });

  it('should append and query events by day', async () => {
    const events = [makeEvent('2026-01-28', 0, 'WORK_ASSIGNED')];
    await store.append(events);

    const result = await store.queryByDay('2026-01-28');
    expect(result).toHaveLength(1);
    expect(result[0].eventId).toBe('evt-2026-01-28-0');
  });

  it('should return empty for unknown day', async () => {
    const result = await store.queryByDay('2026-01-29');
    expect(result).toEqual([]);
  });

  it('should query by actor with optional day range', async () => {
    await store.append([
      makeEvent('2026-01-27', 0, 'SUBMISSION_PROCESSED', 'alice'),
      makeEvent('2026-01-28', 0, 'SUBMISSION_PROCESSED', 'alice'),
      makeEvent('2026-01-29', 0, 'SUBMISSION_PROCESSED', 'alice'),
    ]);

    const all = await store.queryByActor('alice');
    expect(all).toHaveLength(3);

    const ranged = await store.queryByActor('alice', {
      from: '2026-01-28',
      to: '2026-01-28',
    });
    expect(ranged).toHaveLength(1);
    expect(ranged[0].dayId).toBe('2026-01-28');
  });

  it('should query by event type', async () => {
    await store.append([
      makeEvent('2026-01-28', 0, 'WORK_ASSIGNED'),
      makeEvent('2026-01-28', 1, 'DAY_FINALIZED'),
    ]);

    const result = await store.queryByType('DAY_FINALIZED');
    expect(result).toHaveLength(1);
    expect(result[0].eventType).toBe('DAY_FINALIZED');
  });

  it('should get last event', async () => {
    await store.append([
      makeEvent('2026-01-28', 0, 'WORK_ASSIGNED'),
      makeEvent('2026-01-28', 1, 'DAY_FINALIZED'),
    ]);

    const last = await store.getLastEvent();
    expect(last?.sequenceNumber).toBe(1);
  });

  it('should return undefined for empty store', async () => {
    expect(await store.getLastEvent()).toBeUndefined();
  });

  it('should get last event for specific day', async () => {
    await store.append([
      makeEvent('2026-01-27', 0, 'DAY_FINALIZED'),
      makeEvent('2026-01-28', 0, 'WORK_ASSIGNED'),
      makeEvent('2026-01-28', 1, 'DAY_FINALIZED'),
    ]);

    const last = await store.getLastEventForDay('2026-01-28');
    expect(last?.sequenceNumber).toBe(1);
    expect(last?.dayId).toBe('2026-01-28');
  });
});

describe('InMemoryStateStore', () => {
  let store: InMemoryStateStore;

  beforeEach(() => {
    store = new InMemoryStateStore();
  });

  it('should save and load snapshots', async () => {
    const snapshot = {
      dayId: '2026-01-28',
      dayNumber: 1,
      stateHash: 'abc123',
      lastEventHash: 'def456',
      rewardHash: 'ghi789',
      contributorCount: 2,
      createdAt: baseTime.toISOString(),
    };

    await store.saveSnapshot(snapshot);
    const loaded = await store.loadSnapshot('2026-01-28');
    expect(loaded).toEqual(snapshot);
  });

  it('should return undefined for unknown snapshot', async () => {
    expect(await store.loadSnapshot('unknown')).toBeUndefined();
  });

  it('should load latest snapshot', async () => {
    await store.saveSnapshot({
      dayId: '2026-01-27',
      dayNumber: 1,
      stateHash: 'a',
      lastEventHash: 'a',
      rewardHash: 'a',
      contributorCount: 1,
      createdAt: baseTime.toISOString(),
    });
    await store.saveSnapshot({
      dayId: '2026-01-28',
      dayNumber: 2,
      stateHash: 'b',
      lastEventHash: 'b',
      rewardHash: 'b',
      contributorCount: 2,
      createdAt: baseTime.toISOString(),
    });

    const latest = await store.loadLatestSnapshot();
    expect(latest?.dayId).toBe('2026-01-28');
  });

  it('should save and load full state', async () => {
    const state = createEmptyNetworkState();
    state.dayNumber = 5;

    await store.saveState('2026-01-28', state);
    const loaded = await store.loadState('2026-01-28');

    expect(loaded?.dayNumber).toBe(5);
  });
});

describe('InMemoryAssignmentStore', () => {
  let store: InMemoryAssignmentStore;

  beforeEach(() => {
    store = new InMemoryAssignmentStore();
  });

  it('should put and get assignments by day', async () => {
    const assignments: BlockAssignment[] = [
      { contributorId: 'alice', blockIds: ['b1', 'b2'], assignedAt: baseTime, batchNumber: 1 },
      { contributorId: 'bob', blockIds: ['b3'], assignedAt: baseTime, batchNumber: 1 },
    ];

    await store.putAssignments('2026-01-28', assignments);
    const result = await store.getByDay('2026-01-28');
    expect(result).toHaveLength(2);
  });

  it('should get assignments by node', async () => {
    const assignments: BlockAssignment[] = [
      { contributorId: 'alice', blockIds: ['b1', 'b2'], assignedAt: baseTime, batchNumber: 1 },
      { contributorId: 'bob', blockIds: ['b3'], assignedAt: baseTime, batchNumber: 1 },
    ];

    await store.putAssignments('2026-01-28', assignments);
    const result = await store.getByNode('2026-01-28', 'alice');
    expect(result).toHaveLength(1);
    expect(result[0].blockIds).toEqual(['b1', 'b2']);
  });

  it('should return empty for unknown day', async () => {
    expect(await store.getByDay('unknown')).toEqual([]);
  });
});

describe('InMemorySubmissionStore', () => {
  let store: InMemorySubmissionStore;

  beforeEach(() => {
    store = new InMemorySubmissionStore();
  });

  it('should put and list submissions by day', async () => {
    const submissions: BlockSubmission[] = [
      {
        contributorId: 'alice',
        blockId: 'b1',
        blockType: BlockType.INFERENCE,
        resourceUsage: 0.8,
        difficultyMultiplier: 1.0,
        validationPassed: true,
        timestamp: baseTime,
      },
    ];

    await store.putSubmissions('2026-01-28', submissions);
    const result = await store.listByDay('2026-01-28');
    expect(result).toHaveLength(1);
  });

  it('should list submissions by node', async () => {
    const submissions: BlockSubmission[] = [
      {
        contributorId: 'alice',
        blockId: 'b1',
        blockType: BlockType.INFERENCE,
        resourceUsage: 0.8,
        difficultyMultiplier: 1.0,
        validationPassed: true,
        timestamp: baseTime,
      },
      {
        contributorId: 'bob',
        blockId: 'b2',
        blockType: BlockType.INFERENCE,
        resourceUsage: 0.8,
        difficultyMultiplier: 1.0,
        validationPassed: true,
        timestamp: baseTime,
      },
    ];

    await store.putSubmissions('2026-01-28', submissions);
    const result = await store.listByNode('2026-01-28', 'alice');
    expect(result).toHaveLength(1);
    expect(result[0].blockId).toBe('b1');
  });
});

describe('createInMemoryStores', () => {
  it('should create all four stores', () => {
    const stores = createInMemoryStores();
    expect(stores.event).toBeInstanceOf(InMemoryEventStore);
    expect(stores.state).toBeInstanceOf(InMemoryStateStore);
    expect(stores.assignment).toBeInstanceOf(InMemoryAssignmentStore);
    expect(stores.submission).toBeInstanceOf(InMemorySubmissionStore);
  });
});

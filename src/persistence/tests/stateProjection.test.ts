import { applyEvent, projectState } from '../stateProjection';
import { DomainEvent, GENESIS_HASH } from '../eventTypes';
import { createEmptyNetworkState } from '../../services/serviceTypes';
import { BlockType } from '../../types';

const baseTime = '2026-01-28T12:00:00.000Z';

function makeEvent(
  eventType: DomainEvent['eventType'],
  payload: Record<string, unknown>,
  seq: number = 0,
  actorId?: string
): DomainEvent {
  return {
    eventId: `evt-${seq}`,
    dayId: '2026-01-28',
    sequenceNumber: seq,
    timestamp: baseTime,
    eventType,
    actorId,
    payload,
    prevEventHash: seq === 0 ? GENESIS_HASH : `hash-${seq - 1}`,
    eventHash: `hash-${seq}`,
  };
}

describe('applyEvent', () => {
  it('should add contributor on NODE_REGISTERED', () => {
    const state = createEmptyNetworkState();
    const event = makeEvent('NODE_REGISTERED', {
      accountId: 'alice',
      initialReputation: 1.0,
    });

    const newState = applyEvent(state, event);

    expect(newState.contributors.has('alice')).toBe(true);
    expect(newState.contributors.get('alice')?.reputationMultiplier).toBe(1.0);
    expect(newState.contributors.get('alice')?.canaryFailures).toBe(0);
  });

  it('should set canaryBlockIds on CANARIES_SELECTED', () => {
    const state = createEmptyNetworkState();
    const event = makeEvent('CANARIES_SELECTED', {
      canaryBlockIds: ['c1', 'c2', 'c3'],
    });

    const newState = applyEvent(state, event);

    expect(newState.canaryBlockIds.size).toBe(3);
    expect(newState.canaryBlockIds.has('c1')).toBe(true);
  });

  it('should not change state on WORK_ASSIGNED', () => {
    const state = createEmptyNetworkState();
    const event = makeEvent('WORK_ASSIGNED', {
      assignments: [{ contributorId: 'alice', blockIds: ['b1'] }],
    });

    const newState = applyEvent(state, event);
    expect(newState).toBe(state);
  });

  it('should add block on SUBMISSION_PROCESSED', () => {
    let state = createEmptyNetworkState();
    state = applyEvent(
      state,
      makeEvent('NODE_REGISTERED', { accountId: 'alice', initialReputation: 1.0 }, 0)
    );

    const event = makeEvent(
      'SUBMISSION_PROCESSED',
      {
        contributorId: 'alice',
        blockId: 'b1',
        accepted: true,
        isCanary: false,
        blockType: BlockType.INFERENCE,
        resourceUsage: 0.8,
        difficultyMultiplier: 1.0,
        validationPassed: true,
      },
      1,
      'alice'
    );

    const newState = applyEvent(state, event);
    expect(newState.contributors.get('alice')?.completedBlocks.length).toBe(1);
  });

  it('should not add block if SUBMISSION_PROCESSED.accepted is false', () => {
    let state = createEmptyNetworkState();
    state = applyEvent(
      state,
      makeEvent('NODE_REGISTERED', { accountId: 'alice', initialReputation: 1.0 }, 0)
    );

    const event = makeEvent(
      'SUBMISSION_PROCESSED',
      {
        contributorId: 'alice',
        blockId: 'b1',
        accepted: false,
        isCanary: false,
      },
      1
    );

    const newState = applyEvent(state, event);
    expect(newState.contributors.get('alice')?.completedBlocks.length).toBe(0);
  });

  it('should update canaryPasses on CANARY_PASSED', () => {
    let state = createEmptyNetworkState();
    state = applyEvent(
      state,
      makeEvent('NODE_REGISTERED', { accountId: 'alice', initialReputation: 1.0 }, 0)
    );

    const event = makeEvent(
      'CANARY_PASSED',
      {
        contributorId: 'alice',
        blockId: 'c1',
        newCanaryPasses: 5,
      },
      1,
      'alice'
    );

    const newState = applyEvent(state, event);
    expect(newState.contributors.get('alice')?.canaryPasses).toBe(5);
  });

  it('should apply exact penalty values on CANARY_FAILED', () => {
    let state = createEmptyNetworkState();
    state = applyEvent(
      state,
      makeEvent('NODE_REGISTERED', { accountId: 'alice', initialReputation: 1.0 }, 0)
    );

    const failTime = '2026-01-28T14:00:00.000Z';
    const event = makeEvent(
      'CANARY_FAILED',
      {
        contributorId: 'alice',
        blockId: 'c1',
        newCanaryFailures: 3,
        newReputation: 0.7,
        lastCanaryFailureTime: failTime,
      },
      1,
      'alice'
    );

    const newState = applyEvent(state, event);
    const alice = newState.contributors.get('alice')!;

    expect(alice.canaryFailures).toBe(3);
    expect(alice.reputationMultiplier).toBe(0.7);
    expect(alice.lastCanaryFailureTime?.toISOString()).toBe(failTime);
  });

  it('should increment dayNumber on REWARDS_COMMITTED', () => {
    const state = createEmptyNetworkState();
    expect(state.dayNumber).toBe(0);

    const event = makeEvent('REWARDS_COMMITTED', {
      stateHash: 'abc',
      rewardHash: 'def',
      verificationValid: true,
    });

    const newState = applyEvent(state, event);
    expect(newState.dayNumber).toBe(1);
  });

  it('should not change state on DAY_FINALIZED', () => {
    const state = createEmptyNetworkState();
    const event = makeEvent('DAY_FINALIZED', {
      rewards: [],
      totalEmissions: 1000,
    });

    const newState = applyEvent(state, event);
    expect(newState).toBe(state);
  });
});

describe('projectState', () => {
  it('should build state from sequence of events', () => {
    const events: DomainEvent[] = [
      makeEvent('NODE_REGISTERED', { accountId: 'alice', initialReputation: 1.0 }, 0),
      makeEvent('NODE_REGISTERED', { accountId: 'bob', initialReputation: 1.0 }, 1),
      makeEvent('CANARIES_SELECTED', { canaryBlockIds: ['c1'] }, 2),
      makeEvent(
        'SUBMISSION_PROCESSED',
        {
          contributorId: 'alice',
          blockId: 'b1',
          accepted: true,
          isCanary: false,
        },
        3
      ),
      makeEvent('REWARDS_COMMITTED', { stateHash: 'x', rewardHash: 'y' }, 4),
    ];

    const state = projectState(events);

    expect(state.contributors.size).toBe(2);
    expect(state.contributors.get('alice')?.completedBlocks.length).toBe(1);
    expect(state.dayNumber).toBe(1);
    expect(state.canaryBlockIds.has('c1')).toBe(true);
  });

  it('should start from initial state if provided', () => {
    const initial = createEmptyNetworkState();
    initial.dayNumber = 5;

    const events: DomainEvent[] = [
      makeEvent('REWARDS_COMMITTED', {}, 0),
    ];

    const state = projectState(events, initial);
    expect(state.dayNumber).toBe(6);
  });

  it('should produce empty state from empty events', () => {
    const state = projectState([]);
    expect(state.contributors.size).toBe(0);
    expect(state.dayNumber).toBe(0);
  });
});

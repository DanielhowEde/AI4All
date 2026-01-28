import { DEFAULT_REWARD_CONFIG, BlockType } from '../types';
import {
  registerNode,
  updateNodeStatus,
  getNode,
  listActiveNodes,
  listBlockedNodes,
} from './nodeService';
import { createEmptyNetworkState } from './serviceTypes';

describe('NodeService', () => {
  const now = new Date('2026-01-28T12:00:00Z');

  describe('registerNode', () => {
    it('should register a new node with default reputation', () => {
      const state = createEmptyNetworkState();
      const { state: newState, contributor, audit } = registerNode(
        state,
        { accountId: 'alice' },
        now
      );

      expect(contributor.accountId).toBe('alice');
      expect(contributor.reputationMultiplier).toBe(1.0);
      expect(contributor.completedBlocks).toEqual([]);
      expect(contributor.canaryFailures).toBe(0);
      expect(contributor.canaryPasses).toBe(0);
      expect(newState.contributors.size).toBe(1);
      expect(newState.contributors.get('alice')).toEqual(contributor);
      expect(audit.eventType).toBe('NODE_REGISTERED');
    });

    it('should register with custom initial reputation', () => {
      const state = createEmptyNetworkState();
      const { contributor } = registerNode(
        state,
        { accountId: 'bob', initialReputation: 0.5 },
        now
      );

      expect(contributor.reputationMultiplier).toBe(0.5);
    });

    it('should throw on duplicate accountId', () => {
      const state = createEmptyNetworkState();
      const { state: s1 } = registerNode(state, { accountId: 'alice' }, now);

      expect(() => registerNode(s1, { accountId: 'alice' }, now)).toThrow(
        'Node already registered: alice'
      );
    });

    it('should not mutate original state', () => {
      const state = createEmptyNetworkState();
      const original = state.contributors.size;
      registerNode(state, { accountId: 'alice' }, now);

      expect(state.contributors.size).toBe(original);
    });

    it('should append audit entry to existing log', () => {
      const state = createEmptyNetworkState();
      const { state: s1 } = registerNode(state, { accountId: 'alice' }, now);
      const { state: s2 } = registerNode(s1, { accountId: 'bob' }, now);

      expect(s2.auditLog).toHaveLength(2);
      expect(s2.auditLog[0].accountId).toBe('alice');
      expect(s2.auditLog[1].accountId).toBe('bob');
    });
  });

  describe('updateNodeStatus', () => {
    it('should return new contributor with updated reputation', () => {
      const state = createEmptyNetworkState();
      const { contributor } = registerNode(state, { accountId: 'alice' }, now);
      const updated = updateNodeStatus(contributor, { reputationMultiplier: 0.8 });

      expect(updated.reputationMultiplier).toBe(0.8);
      expect(updated.accountId).toBe('alice');
      // Original unchanged
      expect(contributor.reputationMultiplier).toBe(1.0);
    });

    it('should return same values when no updates provided', () => {
      const state = createEmptyNetworkState();
      const { contributor } = registerNode(state, { accountId: 'alice' }, now);
      const updated = updateNodeStatus(contributor, {});

      expect(updated.reputationMultiplier).toBe(contributor.reputationMultiplier);
    });
  });

  describe('getNode', () => {
    it('should return contributor by id', () => {
      const state = createEmptyNetworkState();
      const { state: s1, contributor } = registerNode(state, { accountId: 'alice' }, now);

      expect(getNode(s1, 'alice')).toEqual(contributor);
    });

    it('should return undefined for missing id', () => {
      const state = createEmptyNetworkState();
      expect(getNode(state, 'nobody')).toBeUndefined();
    });
  });

  describe('listActiveNodes', () => {
    it('should return empty for fresh state', () => {
      const state = createEmptyNetworkState();
      expect(listActiveNodes(state, DEFAULT_REWARD_CONFIG, now)).toEqual([]);
    });

    it('should return only active contributors', () => {
      let state = createEmptyNetworkState();

      // Register alice with completed blocks (active)
      const { state: s1 } = registerNode(state, { accountId: 'alice' }, now);
      const alice = s1.contributors.get('alice')!;
      const activeAlice = {
        ...alice,
        completedBlocks: Array.from({ length: 5 }, (_, i) => ({
          blockType: BlockType.INFERENCE,
          resourceUsage: 1.0,
          difficultyMultiplier: 1.0,
          validationPassed: true,
          timestamp: new Date(now.getTime() - i * 1000),
          isCanary: false,
        })),
      };
      const newContributors = new Map(s1.contributors);
      newContributors.set('alice', activeAlice);
      state = { ...s1, contributors: newContributors };

      // Register bob with no blocks (inactive)
      const { state: s2 } = registerNode(state, { accountId: 'bob' }, now);

      const active = listActiveNodes(s2, DEFAULT_REWARD_CONFIG, now);
      expect(active.length).toBe(1);
      expect(active[0].accountId).toBe('alice');
    });
  });

  describe('listBlockedNodes', () => {
    it('should return contributors blocked by canary failure', () => {
      let state = createEmptyNetworkState();
      const { state: s1 } = registerNode(state, { accountId: 'alice' }, now);

      // Give alice a recent canary failure
      const alice = s1.contributors.get('alice')!;
      const blockedAlice = {
        ...alice,
        canaryFailures: 1,
        lastCanaryFailureTime: new Date(now.getTime() - 1 * 60 * 60 * 1000), // 1 hour ago
      };
      const newContributors = new Map(s1.contributors);
      newContributors.set('alice', blockedAlice);
      state = { ...s1, contributors: newContributors };

      const blocked = listBlockedNodes(state, DEFAULT_REWARD_CONFIG, now);
      expect(blocked.length).toBe(1);
      expect(blocked[0].accountId).toBe('alice');
    });
  });
});

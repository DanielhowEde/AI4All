import request from 'supertest';
import { createApp } from '../app';
import { createApiState, computeRosterHash, computeDaySeed } from '../state';
import { createInMemoryStores } from '../../persistence/inMemoryStores';
import { BlockType } from '../../types';

const ADMIN_KEY = 'test-admin-key';

describe('Integration tests', () => {
  describe('Full workflow', () => {
    it('should complete full node lifecycle: register → start day → request work → submit → finalize → query rewards', async () => {
      const stores = createInMemoryStores();
      const state = createApiState(stores);
      const app = createApp(state);

      // 1. Register node
      const registerResponse = await request(app)
        .post('/nodes/register')
        .send({ accountId: 'alice' });

      expect(registerResponse.status).toBe(201);
      const nodeKey = registerResponse.body.nodeKey;

      // 2. Admin starts day
      const startResponse = await request(app)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      expect(startResponse.status).toBe(200);
      expect(startResponse.body.activeContributors).toBe(1);

      // 3. Node requests work
      const workResponse = await request(app)
        .post('/work/request')
        .send({ accountId: 'alice', nodeKey });

      expect(workResponse.status).toBe(200);
      expect(workResponse.body.assignments.length).toBeGreaterThan(0);

      // 4. Node submits work
      const blockId = workResponse.body.assignments[0].blockId;
      const submitResponse = await request(app)
        .post('/work/submit')
        .send({
          accountId: 'alice',
          nodeKey,
          submissions: [
            {
              blockId,
              blockType: BlockType.INFERENCE,
              resourceUsage: 0.9,
              difficultyMultiplier: 1.0,
              validationPassed: true,
            },
          ],
        });

      expect(submitResponse.status).toBe(200);
      expect(submitResponse.body.results[0].accepted).toBe(true);

      // 5. Admin finalizes day
      const finalizeResponse = await request(app)
        .post('/admin/day/finalize')
        .set('X-Admin-Key', ADMIN_KEY);

      expect(finalizeResponse.status).toBe(200);
      expect(finalizeResponse.body.verification.valid).toBe(true);

      // 6. Query rewards
      const rewardsResponse = await request(app)
        .get('/rewards/day')
        .query({ dayId: '2026-01-28' });

      expect(rewardsResponse.status).toBe(200);
      expect(rewardsResponse.body.distribution.rewards.length).toBe(1);
      expect(rewardsResponse.body.distribution.rewards[0].accountId).toBe('alice');
      expect(rewardsResponse.body.distribution.rewards[0].totalReward).toBeGreaterThan(0);
    });

    it('should handle multiple nodes', async () => {
      const stores = createInMemoryStores();
      const state = createApiState(stores);
      const app = createApp(state);

      // Register multiple nodes
      const aliceResponse = await request(app)
        .post('/nodes/register')
        .send({ accountId: 'alice' });
      const bobResponse = await request(app)
        .post('/nodes/register')
        .send({ accountId: 'bob' });
      const charlieResponse = await request(app)
        .post('/nodes/register')
        .send({ accountId: 'charlie' });

      const aliceKey = aliceResponse.body.nodeKey;
      const bobKey = bobResponse.body.nodeKey;
      const charlieKey = charlieResponse.body.nodeKey;

      // Start day
      const startResponse = await request(app)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      expect(startResponse.body.activeContributors).toBe(3);

      // Each node requests work
      const aliceWork = await request(app)
        .post('/work/request')
        .send({ accountId: 'alice', nodeKey: aliceKey });
      const bobWork = await request(app)
        .post('/work/request')
        .send({ accountId: 'bob', nodeKey: bobKey });
      const charlieWork = await request(app)
        .post('/work/request')
        .send({ accountId: 'charlie', nodeKey: charlieKey });

      // All should get assignments (total 440 batches split among 3)
      const totalAssignments =
        aliceWork.body.assignments.length +
        bobWork.body.assignments.length +
        charlieWork.body.assignments.length;

      // Expect roughly 2200 blocks total
      expect(totalAssignments).toBeGreaterThan(100);

      // Each node submits at least one block to become "active" for rewards
      for (const [accountId, nodeKey, workResp] of [
        ['alice', aliceKey, aliceWork],
        ['bob', bobKey, bobWork],
        ['charlie', charlieKey, charlieWork],
      ] as const) {
        const blockId = (workResp as { body: { assignments: Array<{ blockId: string }> } }).body.assignments[0].blockId;
        await request(app)
          .post('/work/submit')
          .send({
            accountId,
            nodeKey,
            submissions: [
              {
                blockId,
                blockType: BlockType.INFERENCE,
                resourceUsage: 0.8,
                difficultyMultiplier: 1.0,
                validationPassed: true,
              },
            ],
          });
      }

      // Finalize
      await request(app)
        .post('/admin/day/finalize')
        .set('X-Admin-Key', ADMIN_KEY);

      // Query rewards
      const rewardsResponse = await request(app)
        .get('/rewards/day')
        .query({ dayId: '2026-01-28' });

      expect(rewardsResponse.body.distribution.rewards.length).toBe(3);
    });
  });

  describe('Determinism', () => {
    it('should produce identical assignments for same dayId + roster', async () => {
      // Run 1
      const stores1 = createInMemoryStores();
      const state1 = createApiState(stores1);
      const app1 = createApp(state1);

      await request(app1)
        .post('/nodes/register')
        .send({ accountId: 'alice' });

      const start1 = await request(app1)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      // Run 2 (fresh state)
      const stores2 = createInMemoryStores();
      const state2 = createApiState(stores2);
      const app2 = createApp(state2);

      await request(app2)
        .post('/nodes/register')
        .send({ accountId: 'alice' });

      const start2 = await request(app2)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      // Compare deterministic outputs
      expect(start1.body.seed).toBe(start2.body.seed);
      expect(start1.body.rosterHash).toBe(start2.body.rosterHash);
      expect(start1.body.totalBlocks).toBe(start2.body.totalBlocks);

      // Compare actual assignments (excluding timestamps which are not deterministic)
      const normalize = (assignments: typeof state1.currentDayAssignments) =>
        assignments.map(a => ({
          contributorId: a.contributorId,
          blockIds: a.blockIds,
          batchNumber: a.batchNumber,
        }));
      expect(normalize(state1.currentDayAssignments)).toEqual(normalize(state2.currentDayAssignments));
    });

    it('should produce different assignments for different roster', async () => {
      // Run 1: alice only
      const stores1 = createInMemoryStores();
      const state1 = createApiState(stores1);
      const app1 = createApp(state1);

      await request(app1)
        .post('/nodes/register')
        .send({ accountId: 'alice' });

      const start1 = await request(app1)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      // Run 2: alice + bob
      const stores2 = createInMemoryStores();
      const state2 = createApiState(stores2);
      const app2 = createApp(state2);

      await request(app2)
        .post('/nodes/register')
        .send({ accountId: 'alice' });
      await request(app2)
        .post('/nodes/register')
        .send({ accountId: 'bob' });

      const start2 = await request(app2)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      // Roster hash and seed should differ
      expect(start1.body.rosterHash).not.toBe(start2.body.rosterHash);
      expect(start1.body.seed).not.toBe(start2.body.seed);
    });

    it('should produce different assignments for different dayId', async () => {
      // Run 1: day 2026-01-28
      const stores1 = createInMemoryStores();
      const state1 = createApiState(stores1);
      const app1 = createApp(state1);

      await request(app1)
        .post('/nodes/register')
        .send({ accountId: 'alice' });

      const start1 = await request(app1)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      // Run 2: day 2026-01-29
      const stores2 = createInMemoryStores();
      const state2 = createApiState(stores2);
      const app2 = createApp(state2);

      await request(app2)
        .post('/nodes/register')
        .send({ accountId: 'alice' });

      const start2 = await request(app2)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-29' });

      // Same roster, different day → different seed
      expect(start1.body.rosterHash).toBe(start2.body.rosterHash); // Same roster
      expect(start1.body.seed).not.toBe(start2.body.seed); // Different seed
    });

    it('should verify rosterHash computation', () => {
      // Test roster hash is deterministic and only depends on sorted accountIds
      const hash1 = computeRosterHash(['alice', 'bob', 'charlie']);
      const hash2 = computeRosterHash(['charlie', 'alice', 'bob']); // Different order
      const hash3 = computeRosterHash(['alice', 'bob']); // Different roster

      expect(hash1).toBe(hash2); // Same accounts → same hash
      expect(hash1).not.toBe(hash3); // Different accounts → different hash
      expect(hash1).toHaveLength(64); // SHA-256 hex
    });

    it('should verify seed computation', () => {
      const rosterHash = computeRosterHash(['alice']);

      const seed1 = computeDaySeed('2026-01-28', rosterHash);
      const seed2 = computeDaySeed('2026-01-28', rosterHash);
      const seed3 = computeDaySeed('2026-01-29', rosterHash);

      expect(seed1).toBe(seed2); // Same inputs → same seed
      expect(seed1).not.toBe(seed3); // Different day → different seed
      expect(typeof seed1).toBe('number');
    });
  });

  describe('Idempotency', () => {
    it('should return same result for duplicate submissions', async () => {
      const stores = createInMemoryStores();
      const state = createApiState(stores);
      const app = createApp(state);

      // Register and get nodeKey
      const registerResponse = await request(app)
        .post('/nodes/register')
        .send({ accountId: 'alice' });
      const nodeKey = registerResponse.body.nodeKey;

      // Start day
      await request(app)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      // Get assignment
      const workResponse = await request(app)
        .post('/work/request')
        .send({ accountId: 'alice', nodeKey });
      const blockId = workResponse.body.assignments[0].blockId;

      const submission = {
        blockId,
        blockType: BlockType.INFERENCE,
        resourceUsage: 0.9,
        difficultyMultiplier: 1.0,
        validationPassed: true,
      };

      // Submit 3 times
      const results = [];
      for (let i = 0; i < 3; i++) {
        const response = await request(app)
          .post('/work/submit')
          .send({ accountId: 'alice', nodeKey, submissions: [submission] });
        results.push(response.body.results[0]);
      }

      // All results should be identical
      expect(results[0]).toEqual(results[1]);
      expect(results[1]).toEqual(results[2]);

      // Only 1 pending submission
      expect(state.pendingSubmissions).toHaveLength(1);
    });
  });

  describe('Day lifecycle', () => {
    it('should prevent work requests during IDLE', async () => {
      const stores = createInMemoryStores();
      const state = createApiState(stores);
      const app = createApp(state);

      const registerResponse = await request(app)
        .post('/nodes/register')
        .send({ accountId: 'alice' });

      const response = await request(app)
        .post('/work/request')
        .send({ accountId: 'alice', nodeKey: registerResponse.body.nodeKey });

      expect(response.status).toBe(409);
    });

    it('should prevent day start during ACTIVE', async () => {
      const stores = createInMemoryStores();
      const state = createApiState(stores);
      const app = createApp(state);

      await request(app)
        .post('/nodes/register')
        .send({ accountId: 'alice' });

      await request(app)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      const response = await request(app)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-29' });

      expect(response.status).toBe(409);
    });

    it('should prevent finalization during IDLE', async () => {
      const stores = createInMemoryStores();
      const state = createApiState(stores);
      const app = createApp(state);

      await request(app)
        .post('/nodes/register')
        .send({ accountId: 'alice' });

      const response = await request(app)
        .post('/admin/day/finalize')
        .set('X-Admin-Key', ADMIN_KEY);

      expect(response.status).toBe(409);
    });
  });
});

import request from 'supertest';
import { createApp } from '../app';
import { createApiState, computeRosterHash, computeDaySeed } from '../state';
import { createInMemoryStores } from '../../persistence/inMemoryStores';
import { BlockType } from '../../types';
import { makeTestNode, signWorkerRequest, TestNode } from './helpers';

const ADMIN_KEY = 'test-admin-key';

describe('Integration tests', () => {
  describe('Full workflow', () => {
    it('should complete full node lifecycle: register → start day → request work → submit → finalize → query rewards', async () => {
      const stores = createInMemoryStores();
      const state = createApiState(stores);
      const app = createApp(state);

      const alice = await makeTestNode();

      // 1. Register node
      const registerResponse = await request(app)
        .post('/nodes/register')
        .send({ accountId: alice.accountId, publicKey: alice.publicKeyHex });

      expect(registerResponse.status).toBe(201);

      // 2. Admin starts day
      const startResponse = await request(app)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      expect(startResponse.status).toBe(200);
      expect(startResponse.body.activeContributors).toBe(1);

      // 3. Node requests work
      const workAuth = await signWorkerRequest(alice.accountId, alice.secretKeyHex);
      const workResponse = await request(app)
        .post('/work/request')
        .send({ accountId: alice.accountId, ...workAuth });

      expect(workResponse.status).toBe(200);
      expect(workResponse.body.assignments.length).toBeGreaterThan(0);

      // 4. Node submits work
      const blockId = workResponse.body.assignments[0].blockId;
      const submitAuth = await signWorkerRequest(alice.accountId, alice.secretKeyHex);
      const submitResponse = await request(app)
        .post('/work/submit')
        .send({
          accountId: alice.accountId,
          ...submitAuth,
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
      expect(rewardsResponse.body.distribution.rewards[0].accountId).toBe(alice.accountId);
      expect(rewardsResponse.body.distribution.rewards[0].totalReward).toBeGreaterThan(0);
    });

    it('should handle multiple nodes', async () => {
      const stores = createInMemoryStores();
      const state = createApiState(stores);
      const app = createApp(state);

      const alice = await makeTestNode();
      const bob = await makeTestNode();
      const charlie = await makeTestNode();

      await request(app).post('/nodes/register').send({ accountId: alice.accountId, publicKey: alice.publicKeyHex });
      await request(app).post('/nodes/register').send({ accountId: bob.accountId, publicKey: bob.publicKeyHex });
      await request(app).post('/nodes/register').send({ accountId: charlie.accountId, publicKey: charlie.publicKeyHex });

      const startResponse = await request(app)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      expect(startResponse.body.activeContributors).toBe(3);

      const aliceAuth = await signWorkerRequest(alice.accountId, alice.secretKeyHex);
      const bobAuth = await signWorkerRequest(bob.accountId, bob.secretKeyHex);
      const charlieAuth = await signWorkerRequest(charlie.accountId, charlie.secretKeyHex);

      const aliceWork = await request(app).post('/work/request').send({ accountId: alice.accountId, ...aliceAuth });
      const bobWork = await request(app).post('/work/request').send({ accountId: bob.accountId, ...bobAuth });
      const charlieWork = await request(app).post('/work/request').send({ accountId: charlie.accountId, ...charlieAuth });

      const totalAssignments =
        aliceWork.body.assignments.length +
        bobWork.body.assignments.length +
        charlieWork.body.assignments.length;

      expect(totalAssignments).toBeGreaterThan(100);

      for (const [node, workResp] of [
        [alice, aliceWork],
        [bob, bobWork],
        [charlie, charlieWork],
      ] as [TestNode, typeof aliceWork][]) {
        const blockId = workResp.body.assignments[0].blockId;
        const auth = await signWorkerRequest(node.accountId, node.secretKeyHex);
        await request(app)
          .post('/work/submit')
          .send({
            accountId: node.accountId,
            ...auth,
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

      await request(app)
        .post('/admin/day/finalize')
        .set('X-Admin-Key', ADMIN_KEY);

      const rewardsResponse = await request(app)
        .get('/rewards/day')
        .query({ dayId: '2026-01-28' });

      expect(rewardsResponse.body.distribution.rewards.length).toBe(3);
    });
  });

  describe('Determinism', () => {
    it('should produce identical assignments for same dayId + roster', async () => {
      // Create a keypair once — both runs use the same accountId to get identical rosters
      const sharedNode = await makeTestNode();

      // Run 1
      const stores1 = createInMemoryStores();
      const state1 = createApiState(stores1);
      const app1 = createApp(state1);

      await request(app1).post('/nodes/register').send({ accountId: sharedNode.accountId, publicKey: sharedNode.publicKeyHex });

      const start1 = await request(app1)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      // Run 2 (fresh state, same node)
      const stores2 = createInMemoryStores();
      const state2 = createApiState(stores2);
      const app2 = createApp(state2);

      await request(app2).post('/nodes/register').send({ accountId: sharedNode.accountId, publicKey: sharedNode.publicKeyHex });

      const start2 = await request(app2)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      expect(start1.body.seed).toBe(start2.body.seed);
      expect(start1.body.rosterHash).toBe(start2.body.rosterHash);
      expect(start1.body.totalBlocks).toBe(start2.body.totalBlocks);

      const normalize = (assignments: typeof state1.currentDayAssignments) =>
        assignments.map(a => ({
          contributorId: a.contributorId,
          blockIds: a.blockIds,
          batchNumber: a.batchNumber,
        }));
      expect(normalize(state1.currentDayAssignments)).toEqual(normalize(state2.currentDayAssignments));
    });

    it('should produce different assignments for different roster', async () => {
      const alice = await makeTestNode();
      const bob = await makeTestNode();

      // Run 1: alice only
      const stores1 = createInMemoryStores();
      const state1 = createApiState(stores1);
      const app1 = createApp(state1);

      await request(app1).post('/nodes/register').send({ accountId: alice.accountId, publicKey: alice.publicKeyHex });

      const start1 = await request(app1)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      // Run 2: alice + bob
      const stores2 = createInMemoryStores();
      const state2 = createApiState(stores2);
      const app2 = createApp(state2);

      await request(app2).post('/nodes/register').send({ accountId: alice.accountId, publicKey: alice.publicKeyHex });
      await request(app2).post('/nodes/register').send({ accountId: bob.accountId, publicKey: bob.publicKeyHex });

      const start2 = await request(app2)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      expect(start1.body.rosterHash).not.toBe(start2.body.rosterHash);
      expect(start1.body.seed).not.toBe(start2.body.seed);
    });

    it('should produce different assignments for different dayId', async () => {
      const sharedNode = await makeTestNode();

      // Run 1: day 2026-01-28
      const stores1 = createInMemoryStores();
      const state1 = createApiState(stores1);
      const app1 = createApp(state1);

      await request(app1).post('/nodes/register').send({ accountId: sharedNode.accountId, publicKey: sharedNode.publicKeyHex });

      const start1 = await request(app1)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      // Run 2: day 2026-01-29
      const stores2 = createInMemoryStores();
      const state2 = createApiState(stores2);
      const app2 = createApp(state2);

      await request(app2).post('/nodes/register').send({ accountId: sharedNode.accountId, publicKey: sharedNode.publicKeyHex });

      const start2 = await request(app2)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-29' });

      expect(start1.body.rosterHash).toBe(start2.body.rosterHash); // Same roster
      expect(start1.body.seed).not.toBe(start2.body.seed); // Different seed
    });

    it('should verify rosterHash computation', () => {
      const hash1 = computeRosterHash(['alice', 'bob', 'charlie']);
      const hash2 = computeRosterHash(['charlie', 'alice', 'bob']);
      const hash3 = computeRosterHash(['alice', 'bob']);

      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hash3);
      expect(hash1).toHaveLength(64);
    });

    it('should verify seed computation', () => {
      const rosterHash = computeRosterHash(['alice']);

      const seed1 = computeDaySeed('2026-01-28', rosterHash);
      const seed2 = computeDaySeed('2026-01-28', rosterHash);
      const seed3 = computeDaySeed('2026-01-29', rosterHash);

      expect(seed1).toBe(seed2);
      expect(seed1).not.toBe(seed3);
      expect(typeof seed1).toBe('number');
    });
  });

  describe('Idempotency', () => {
    it('should return same result for duplicate submissions', async () => {
      const stores = createInMemoryStores();
      const state = createApiState(stores);
      const app = createApp(state);

      const alice = await makeTestNode();
      await request(app).post('/nodes/register').send({ accountId: alice.accountId, publicKey: alice.publicKeyHex });

      await request(app)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      const workAuth = await signWorkerRequest(alice.accountId, alice.secretKeyHex);
      const workResponse = await request(app)
        .post('/work/request')
        .send({ accountId: alice.accountId, ...workAuth });
      const blockId = workResponse.body.assignments[0].blockId;

      const submission = {
        blockId,
        blockType: BlockType.INFERENCE,
        resourceUsage: 0.9,
        difficultyMultiplier: 1.0,
        validationPassed: true,
      };

      const results = [];
      for (let i = 0; i < 3; i++) {
        const auth = await signWorkerRequest(alice.accountId, alice.secretKeyHex);
        const response = await request(app)
          .post('/work/submit')
          .send({ accountId: alice.accountId, ...auth, submissions: [submission] });
        results.push(response.body.results[0]);
      }

      expect(results[0]).toEqual(results[1]);
      expect(results[1]).toEqual(results[2]);
      expect(state.pendingSubmissions).toHaveLength(1);
    });
  });

  describe('Day lifecycle', () => {
    it('should prevent work requests during IDLE', async () => {
      const stores = createInMemoryStores();
      const state = createApiState(stores);
      const app = createApp(state);

      const alice = await makeTestNode();
      await request(app).post('/nodes/register').send({ accountId: alice.accountId, publicKey: alice.publicKeyHex });

      const auth = await signWorkerRequest(alice.accountId, alice.secretKeyHex);
      const response = await request(app)
        .post('/work/request')
        .send({ accountId: alice.accountId, ...auth });

      expect(response.status).toBe(409);
    });

    it('should prevent day start during ACTIVE', async () => {
      const stores = createInMemoryStores();
      const state = createApiState(stores);
      const app = createApp(state);

      const alice = await makeTestNode();
      await request(app).post('/nodes/register').send({ accountId: alice.accountId, publicKey: alice.publicKeyHex });

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

      const alice = await makeTestNode();
      await request(app).post('/nodes/register').send({ accountId: alice.accountId, publicKey: alice.publicKeyHex });

      const response = await request(app)
        .post('/admin/day/finalize')
        .set('X-Admin-Key', ADMIN_KEY);

      expect(response.status).toBe(409);
    });
  });
});

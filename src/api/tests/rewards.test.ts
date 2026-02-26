import request from 'supertest';
import { createApp } from '../app';
import { createApiState, ApiState } from '../state';
import { createInMemoryStores } from '../../persistence/inMemoryStores';
import { ErrorCodes } from '../types';
import { BlockType } from '../../types';
import { verifyRewardProof, deserializeRewardProof } from '../../merkle';
import { makeTestNode, signWorkerRequest, TestNode } from './helpers';

const ADMIN_KEY = 'test-admin-key';

describe('/rewards endpoints', () => {
  let state: ApiState;
  let app: ReturnType<typeof createApp>;
  let alice: TestNode;

  beforeEach(async () => {
    const stores = createInMemoryStores();
    state = createApiState(stores);
    app = createApp(state);

    alice = await makeTestNode();
    await request(app)
      .post('/nodes/register')
      .send({ accountId: alice.accountId, publicKey: alice.publicKeyHex });
  });

  async function completeDay(dayId: string) {
    await request(app)
      .post('/admin/day/start')
      .set('X-Admin-Key', ADMIN_KEY)
      .send({ dayId });

    const workAuth = await signWorkerRequest(alice.accountId, alice.secretKeyHex);
    const workResponse = await request(app)
      .post('/work/request')
      .send({ accountId: alice.accountId, ...workAuth });

    const blockId = workResponse.body.assignments[0].blockId;
    const submitAuth = await signWorkerRequest(alice.accountId, alice.secretKeyHex);
    await request(app)
      .post('/work/submit')
      .send({
        accountId: alice.accountId,
        ...submitAuth,
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

    await request(app)
      .post('/admin/day/finalize')
      .set('X-Admin-Key', ADMIN_KEY);
  }

  describe('GET /rewards/day', () => {
    it('should return 404 when no distributions exist', async () => {
      const response = await request(app)
        .get('/rewards/day');

      expect(response.status).toBe(404);
      expect(response.body.code).toBe(ErrorCodes.NO_DISTRIBUTION_FOUND);
    });

    it('should return 404 for non-existent dayId', async () => {
      const response = await request(app)
        .get('/rewards/day')
        .query({ dayId: '2026-01-28' });

      expect(response.status).toBe(404);
      expect(response.body.code).toBe(ErrorCodes.NO_DISTRIBUTION_FOUND);
    });

    it('should return rewards after finalization', async () => {
      await completeDay('2026-01-28');

      const response = await request(app)
        .get('/rewards/day')
        .query({ dayId: '2026-01-28' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.dayId).toBe('2026-01-28');
      expect(response.body.distribution).toBeDefined();
      expect(response.body.distribution.totalEmissions).toBeGreaterThan(0);
      expect(Array.isArray(response.body.distribution.rewards)).toBe(true);
    });

    it('should return latest day when no dayId specified', async () => {
      await completeDay('2026-01-28');
      await completeDay('2026-01-29');

      const response = await request(app)
        .get('/rewards/day');

      expect(response.status).toBe(200);
      expect(response.body.dayId).toBe('2026-01-29');
    });

    it('should include reward breakdown per contributor', async () => {
      await completeDay('2026-01-28');

      const response = await request(app)
        .get('/rewards/day')
        .query({ dayId: '2026-01-28' });

      const aliceReward = response.body.distribution.rewards.find(
        (r: { accountId: string }) => r.accountId === alice.accountId
      );

      expect(aliceReward).toBeDefined();
      expect(aliceReward.totalReward).toBeGreaterThan(0);
      expect(aliceReward.basePoolReward).toBeDefined();
      expect(aliceReward.performancePoolReward).toBeDefined();
    });
  });

  describe('GET /rewards/proof', () => {
    it('should return 400 for missing dayId', async () => {
      const response = await request(app)
        .get('/rewards/proof')
        .query({ accountId: alice.accountId });

      expect(response.status).toBe(400);
    });

    it('should return 400 for missing accountId', async () => {
      const response = await request(app)
        .get('/rewards/proof')
        .query({ dayId: '2026-01-28' });

      expect(response.status).toBe(400);
    });

    it('should return 404 for non-existent day', async () => {
      const response = await request(app)
        .get('/rewards/proof')
        .query({ dayId: '2026-01-28', accountId: alice.accountId });

      expect(response.status).toBe(404);
      expect(response.body.code).toBe(ErrorCodes.NO_DISTRIBUTION_FOUND);
    });

    it('should return 404 for non-existent account', async () => {
      await completeDay('2026-01-28');

      const response = await request(app)
        .get('/rewards/proof')
        .query({ dayId: '2026-01-28', accountId: 'unknown' });

      expect(response.status).toBe(404);
    });

    it('should return valid Merkle proof', async () => {
      await completeDay('2026-01-28');

      const response = await request(app)
        .get('/rewards/proof')
        .query({ dayId: '2026-01-28', accountId: alice.accountId });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.dayId).toBe('2026-01-28');
      expect(response.body.accountId).toBe(alice.accountId);
      expect(response.body.rewardRoot).toBeDefined();
      expect(response.body.rewardRoot).toHaveLength(64);
      expect(response.body.proof).toBeDefined();
      expect(response.body.proof.amountMicrounits).toBeDefined();
      expect(response.body.proof.leaf).toBeDefined();
      expect(response.body.proof.leafHash).toBeDefined();
    });

    it('should return proof that verifies correctly', async () => {
      await completeDay('2026-01-28');

      const response = await request(app)
        .get('/rewards/proof')
        .query({ dayId: '2026-01-28', accountId: alice.accountId });

      expect(response.status).toBe(200);

      const proof = deserializeRewardProof(response.body.proof);
      expect(verifyRewardProof(proof)).toBe(true);
    });

    it('should produce consistent root across multiple calls', async () => {
      await completeDay('2026-01-28');

      const response1 = await request(app)
        .get('/rewards/proof')
        .query({ dayId: '2026-01-28', accountId: alice.accountId });

      const response2 = await request(app)
        .get('/rewards/proof')
        .query({ dayId: '2026-01-28', accountId: alice.accountId });

      expect(response1.body.rewardRoot).toBe(response2.body.rewardRoot);
    });
  });

  describe('GET /rewards/root', () => {
    it('should return 400 for missing dayId', async () => {
      const response = await request(app)
        .get('/rewards/root');

      expect(response.status).toBe(400);
    });

    it('should return 404 for non-existent day', async () => {
      const response = await request(app)
        .get('/rewards/root')
        .query({ dayId: '2026-01-28' });

      expect(response.status).toBe(404);
      expect(response.body.code).toBe(ErrorCodes.NO_DISTRIBUTION_FOUND);
    });

    it('should return Merkle root for finalized day', async () => {
      await completeDay('2026-01-28');

      const response = await request(app)
        .get('/rewards/root')
        .query({ dayId: '2026-01-28' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.dayId).toBe('2026-01-28');
      expect(response.body.rewardRoot).toBeDefined();
      expect(response.body.rewardRoot).toHaveLength(64);
      expect(response.body.leafCount).toBeGreaterThan(0);
      expect(response.body.totalEmissions).toBeGreaterThan(0);
    });

    it('should produce same root as proof endpoint', async () => {
      await completeDay('2026-01-28');

      const rootResponse = await request(app)
        .get('/rewards/root')
        .query({ dayId: '2026-01-28' });

      const proofResponse = await request(app)
        .get('/rewards/proof')
        .query({ dayId: '2026-01-28', accountId: alice.accountId });

      expect(rootResponse.body.rewardRoot).toBe(proofResponse.body.rewardRoot);
    });

    it('should be deterministic across multiple computations', async () => {
      await completeDay('2026-01-28');

      const roots: string[] = [];
      for (let i = 0; i < 5; i++) {
        const response = await request(app)
          .get('/rewards/root')
          .query({ dayId: '2026-01-28' });
        roots.push(response.body.rewardRoot);
      }

      const uniqueRoots = new Set(roots);
      expect(uniqueRoots.size).toBe(1);
    });
  });
});

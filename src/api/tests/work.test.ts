import request from 'supertest';
import { createApp } from '../app';
import { createApiState, ApiState } from '../state';
import { createInMemoryStores } from '../../persistence/inMemoryStores';
import { ErrorCodes } from '../types';
import { BlockType } from '../../types';
import { makeTestNode, signWorkerRequest, TestNode } from './helpers';

const ADMIN_KEY = 'test-admin-key';

describe('/work endpoints', () => {
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

  describe('POST /work/request', () => {
    it('should reject request before day starts', async () => {
      const auth = await signWorkerRequest(alice.accountId, alice.secretKeyHex);
      const response = await request(app)
        .post('/work/request')
        .send({ accountId: alice.accountId, ...auth });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe(ErrorCodes.DAY_NOT_STARTED);
    });

    it('should return assignments after day starts', async () => {
      await request(app)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      const auth = await signWorkerRequest(alice.accountId, alice.secretKeyHex);
      const response = await request(app)
        .post('/work/request')
        .send({ accountId: alice.accountId, ...auth });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.dayId).toBe('2026-01-28');
      expect(Array.isArray(response.body.assignments)).toBe(true);
    });

    it('should return ROSTER_LOCKED for late registrant', async () => {
      await request(app)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      const bob = await makeTestNode();
      await request(app)
        .post('/nodes/register')
        .send({ accountId: bob.accountId, publicKey: bob.publicKeyHex });

      const auth = await signWorkerRequest(bob.accountId, bob.secretKeyHex);
      const response = await request(app)
        .post('/work/request')
        .send({ accountId: bob.accountId, ...auth });

      expect(response.status).toBe(200);
      expect(response.body.assignments).toHaveLength(0);
      expect(response.body.reason).toBe('ROSTER_LOCKED');
    });

    it('should reject request with invalid signature', async () => {
      await request(app)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      const response = await request(app)
        .post('/work/request')
        .send({
          accountId: alice.accountId,
          timestamp: new Date().toISOString(),
          signature: 'aa'.repeat(3309),
        });

      expect(response.status).toBe(401);
      expect(response.body.code).toBe(ErrorCodes.INVALID_SIGNATURE);
    });

    it('should reject request for unknown node', async () => {
      await request(app)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      const unknown = await makeTestNode();
      const auth = await signWorkerRequest(unknown.accountId, unknown.secretKeyHex);
      const response = await request(app)
        .post('/work/request')
        .send({ accountId: unknown.accountId, ...auth });

      expect(response.status).toBe(404);
      expect(response.body.code).toBe(ErrorCodes.NODE_NOT_FOUND);
    });
  });

  describe('POST /work/submit', () => {
    beforeEach(async () => {
      await request(app)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });
    });

    it('should reject submission before day starts', async () => {
      const stores = createInMemoryStores();
      const freshState = createApiState(stores);
      const freshApp = createApp(freshState);

      const freshNode = await makeTestNode();
      await request(freshApp)
        .post('/nodes/register')
        .send({ accountId: freshNode.accountId, publicKey: freshNode.publicKeyHex });

      const auth = await signWorkerRequest(freshNode.accountId, freshNode.secretKeyHex);
      const response = await request(freshApp)
        .post('/work/submit')
        .send({ accountId: freshNode.accountId, ...auth, submissions: [] });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe(ErrorCodes.DAY_NOT_STARTED);
    });

    it('should accept submission for assigned block', async () => {
      const workAuth = await signWorkerRequest(alice.accountId, alice.secretKeyHex);
      const workResponse = await request(app)
        .post('/work/request')
        .send({ accountId: alice.accountId, ...workAuth });

      const assignments = workResponse.body.assignments;
      expect(assignments.length).toBeGreaterThan(0);
      const blockId = assignments[0].blockId;

      const submitAuth = await signWorkerRequest(alice.accountId, alice.secretKeyHex);
      const response = await request(app)
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

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.results).toHaveLength(1);
      expect(response.body.results[0].accepted).toBe(true);
      expect(response.body.results[0].blockId).toBe(blockId);
    });

    it('should reject submission for unassigned block', async () => {
      const auth = await signWorkerRequest(alice.accountId, alice.secretKeyHex);
      const response = await request(app)
        .post('/work/submit')
        .send({
          accountId: alice.accountId,
          ...auth,
          submissions: [
            {
              blockId: 'unassigned-block-id',
              blockType: BlockType.INFERENCE,
              resourceUsage: 0.8,
              difficultyMultiplier: 1.0,
              validationPassed: true,
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.results[0].accepted).toBe(false);
      expect(response.body.results[0].error).toContain('not assigned');
    });

    it('should return cached result for duplicate submission (idempotency)', async () => {
      const workAuth = await signWorkerRequest(alice.accountId, alice.secretKeyHex);
      const workResponse = await request(app)
        .post('/work/request')
        .send({ accountId: alice.accountId, ...workAuth });

      const blockId = workResponse.body.assignments[0].blockId;
      const submission = {
        blockId,
        blockType: BlockType.INFERENCE,
        resourceUsage: 0.8,
        difficultyMultiplier: 1.0,
        validationPassed: true,
      };

      const auth1 = await signWorkerRequest(alice.accountId, alice.secretKeyHex);
      const response1 = await request(app)
        .post('/work/submit')
        .send({ accountId: alice.accountId, ...auth1, submissions: [submission] });

      const auth2 = await signWorkerRequest(alice.accountId, alice.secretKeyHex);
      const response2 = await request(app)
        .post('/work/submit')
        .send({ accountId: alice.accountId, ...auth2, submissions: [submission] });

      expect(response1.body.results[0]).toEqual(response2.body.results[0]);
      expect(state.pendingSubmissions).toHaveLength(1);
    });

    it('should reject submission with wrong dayId', async () => {
      const workAuth = await signWorkerRequest(alice.accountId, alice.secretKeyHex);
      const workResponse = await request(app)
        .post('/work/request')
        .send({ accountId: alice.accountId, ...workAuth });

      const blockId = workResponse.body.assignments[0].blockId;

      const auth = await signWorkerRequest(alice.accountId, alice.secretKeyHex);
      const response = await request(app)
        .post('/work/submit')
        .send({
          accountId: alice.accountId,
          ...auth,
          dayId: '2026-01-29',
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

      expect(response.status).toBe(409);
      expect(response.body.code).toBe(ErrorCodes.DAY_MISMATCH);
    });

    it('should reject submission with invalid signature', async () => {
      const response = await request(app)
        .post('/work/submit')
        .send({
          accountId: alice.accountId,
          timestamp: new Date().toISOString(),
          signature: 'aa'.repeat(3309),
          submissions: [],
        });

      expect(response.status).toBe(401);
      expect(response.body.code).toBe(ErrorCodes.INVALID_SIGNATURE);
    });

    it('should handle multiple submissions in one request', async () => {
      const workAuth = await signWorkerRequest(alice.accountId, alice.secretKeyHex);
      const workResponse = await request(app)
        .post('/work/request')
        .send({ accountId: alice.accountId, ...workAuth });

      const assignments = workResponse.body.assignments;
      expect(assignments.length).toBeGreaterThanOrEqual(2);

      const submissions = assignments.slice(0, 2).map((a: { blockId: string }) => ({
        blockId: a.blockId,
        blockType: BlockType.INFERENCE,
        resourceUsage: 0.8,
        difficultyMultiplier: 1.0,
        validationPassed: true,
      }));

      const auth = await signWorkerRequest(alice.accountId, alice.secretKeyHex);
      const response = await request(app)
        .post('/work/submit')
        .send({ accountId: alice.accountId, ...auth, submissions });

      expect(response.status).toBe(200);
      expect(response.body.results).toHaveLength(2);
      expect(response.body.results.every((r: { accepted: boolean }) => r.accepted)).toBe(true);
    });
  });
});

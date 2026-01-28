import request from 'supertest';
import { createApp } from '../app';
import { createApiState, ApiState } from '../state';
import { createInMemoryStores } from '../../persistence/inMemoryStores';
import { ErrorCodes } from '../types';
import { BlockType } from '../../types';

const ADMIN_KEY = 'test-admin-key';

describe('/work endpoints', () => {
  let state: ApiState;
  let app: ReturnType<typeof createApp>;
  let aliceKey: string;

  beforeEach(async () => {
    const stores = createInMemoryStores();
    state = createApiState(stores);
    app = createApp(state);

    // Register alice
    const response = await request(app)
      .post('/nodes/register')
      .send({ accountId: 'alice' });
    aliceKey = response.body.nodeKey;
  });

  describe('POST /work/request', () => {
    it('should reject request before day starts', async () => {
      const response = await request(app)
        .post('/work/request')
        .send({ accountId: 'alice', nodeKey: aliceKey });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe(ErrorCodes.DAY_NOT_STARTED);
    });

    it('should return assignments after day starts', async () => {
      // Start day
      await request(app)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      // Request work
      const response = await request(app)
        .post('/work/request')
        .send({ accountId: 'alice', nodeKey: aliceKey });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.dayId).toBe('2026-01-28');
      expect(Array.isArray(response.body.assignments)).toBe(true);
    });

    it('should return ROSTER_LOCKED for late registrant', async () => {
      // Start day without bob
      await request(app)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      // Register bob after day starts
      const bobResponse = await request(app)
        .post('/nodes/register')
        .send({ accountId: 'bob' });
      const bobKey = bobResponse.body.nodeKey;

      // Bob requests work
      const response = await request(app)
        .post('/work/request')
        .send({ accountId: 'bob', nodeKey: bobKey });

      expect(response.status).toBe(200);
      expect(response.body.assignments).toHaveLength(0);
      expect(response.body.reason).toBe('ROSTER_LOCKED');
    });

    it('should reject request with invalid nodeKey', async () => {
      await request(app)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      const response = await request(app)
        .post('/work/request')
        .send({ accountId: 'alice', nodeKey: 'wrong-key' });

      expect(response.status).toBe(401);
      expect(response.body.code).toBe(ErrorCodes.INVALID_NODE_KEY);
    });

    it('should reject request for unknown node', async () => {
      await request(app)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      const response = await request(app)
        .post('/work/request')
        .send({ accountId: 'unknown', nodeKey: 'any-key' });

      expect(response.status).toBe(404);
      expect(response.body.code).toBe(ErrorCodes.NODE_NOT_FOUND);
    });
  });

  describe('POST /work/submit', () => {
    beforeEach(async () => {
      // Start day
      await request(app)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });
    });

    it('should reject submission before day starts', async () => {
      // Create new state without starting day
      const stores = createInMemoryStores();
      const freshState = createApiState(stores);
      const freshApp = createApp(freshState);

      const regResponse = await request(freshApp)
        .post('/nodes/register')
        .send({ accountId: 'alice' });

      const response = await request(freshApp)
        .post('/work/submit')
        .send({
          accountId: 'alice',
          nodeKey: regResponse.body.nodeKey,
          submissions: [],
        });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe(ErrorCodes.DAY_NOT_STARTED);
    });

    it('should accept submission for assigned block', async () => {
      // Get assignments
      const workResponse = await request(app)
        .post('/work/request')
        .send({ accountId: 'alice', nodeKey: aliceKey });

      const assignments = workResponse.body.assignments;
      expect(assignments.length).toBeGreaterThan(0);

      const blockId = assignments[0].blockId;

      // Submit work
      const response = await request(app)
        .post('/work/submit')
        .send({
          accountId: 'alice',
          nodeKey: aliceKey,
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
      const response = await request(app)
        .post('/work/submit')
        .send({
          accountId: 'alice',
          nodeKey: aliceKey,
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
      // Get assignments
      const workResponse = await request(app)
        .post('/work/request')
        .send({ accountId: 'alice', nodeKey: aliceKey });

      const blockId = workResponse.body.assignments[0].blockId;

      const submission = {
        blockId,
        blockType: BlockType.INFERENCE,
        resourceUsage: 0.8,
        difficultyMultiplier: 1.0,
        validationPassed: true,
      };

      // First submission
      const response1 = await request(app)
        .post('/work/submit')
        .send({ accountId: 'alice', nodeKey: aliceKey, submissions: [submission] });

      // Second submission (duplicate)
      const response2 = await request(app)
        .post('/work/submit')
        .send({ accountId: 'alice', nodeKey: aliceKey, submissions: [submission] });

      expect(response1.body.results[0]).toEqual(response2.body.results[0]);

      // Should only have 1 pending submission (not 2)
      expect(state.pendingSubmissions).toHaveLength(1);
    });

    it('should reject submission with wrong dayId', async () => {
      const workResponse = await request(app)
        .post('/work/request')
        .send({ accountId: 'alice', nodeKey: aliceKey });

      const blockId = workResponse.body.assignments[0].blockId;

      const response = await request(app)
        .post('/work/submit')
        .send({
          accountId: 'alice',
          nodeKey: aliceKey,
          dayId: '2026-01-29', // Wrong day
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

    it('should reject submission with invalid nodeKey', async () => {
      const response = await request(app)
        .post('/work/submit')
        .send({
          accountId: 'alice',
          nodeKey: 'wrong-key',
          submissions: [],
        });

      expect(response.status).toBe(401);
      expect(response.body.code).toBe(ErrorCodes.INVALID_NODE_KEY);
    });

    it('should handle multiple submissions in one request', async () => {
      // Get assignments
      const workResponse = await request(app)
        .post('/work/request')
        .send({ accountId: 'alice', nodeKey: aliceKey });

      const assignments = workResponse.body.assignments;
      expect(assignments.length).toBeGreaterThanOrEqual(2);

      const submissions = assignments.slice(0, 2).map((a: { blockId: string }) => ({
        blockId: a.blockId,
        blockType: BlockType.INFERENCE,
        resourceUsage: 0.8,
        difficultyMultiplier: 1.0,
        validationPassed: true,
      }));

      const response = await request(app)
        .post('/work/submit')
        .send({ accountId: 'alice', nodeKey: aliceKey, submissions });

      expect(response.status).toBe(200);
      expect(response.body.results).toHaveLength(2);
      expect(response.body.results.every((r: { accepted: boolean }) => r.accepted)).toBe(true);
    });
  });
});

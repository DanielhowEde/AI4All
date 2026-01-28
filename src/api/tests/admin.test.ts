import request from 'supertest';
import { createApp } from '../app';
import { createApiState, ApiState } from '../state';
import { createInMemoryStores } from '../../persistence/inMemoryStores';
import { ErrorCodes } from '../types';
import { BlockType } from '../../types';

const ADMIN_KEY = 'test-admin-key';

describe('/admin endpoints', () => {
  let state: ApiState;
  let app: ReturnType<typeof createApp>;
  let aliceKey: string;

  beforeEach(async () => {
    const stores = createInMemoryStores();
    state = createApiState(stores);
    app = createApp(state);

    // Register a node for testing
    const response = await request(app)
      .post('/nodes/register')
      .send({ accountId: 'alice' });
    aliceKey = response.body.nodeKey;
  });

  describe('POST /admin/day/start', () => {
    it('should start day successfully', async () => {
      const response = await request(app)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.dayId).toBe('2026-01-28');
      expect(response.body.activeContributors).toBe(1);
      expect(response.body.totalBlocks).toBeGreaterThan(0);
      expect(response.body.seed).toBeDefined();
      expect(response.body.rosterHash).toBeDefined();
      expect(response.body.rosterHash.length).toBe(64); // SHA-256 hex
    });

    it('should use today UTC if dayId not provided', async () => {
      const response = await request(app)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.dayId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should reject starting day twice with 409', async () => {
      await request(app)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      const response = await request(app)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe(ErrorCodes.DAY_ALREADY_ACTIVE);
    });

    it('should reject without X-Admin-Key header', async () => {
      const response = await request(app)
        .post('/admin/day/start')
        .send({ dayId: '2026-01-28' });

      expect(response.status).toBe(401);
      expect(response.body.code).toBe(ErrorCodes.MISSING_ADMIN_KEY);
    });

    it('should reject with invalid admin key', async () => {
      const response = await request(app)
        .post('/admin/day/start')
        .set('X-Admin-Key', 'wrong-key')
        .send({ dayId: '2026-01-28' });

      expect(response.status).toBe(401);
      expect(response.body.code).toBe(ErrorCodes.INVALID_ADMIN_KEY);
    });

    it('should lock roster at day start', async () => {
      await request(app)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      expect(state.currentRosterAccountIds).toContain('alice');
      expect(state.dayPhase).toBe('ACTIVE');
    });
  });

  describe('GET /admin/day/status', () => {
    it('should return IDLE status before day starts', async () => {
      const response = await request(app)
        .get('/admin/day/status')
        .set('X-Admin-Key', ADMIN_KEY);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.dayPhase).toBe('IDLE');
      expect(response.body.dayId).toBeNull();
      expect(response.body.rosterSize).toBe(0);
    });

    it('should return ACTIVE status after day starts', async () => {
      await request(app)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      const response = await request(app)
        .get('/admin/day/status')
        .set('X-Admin-Key', ADMIN_KEY);

      expect(response.status).toBe(200);
      expect(response.body.dayPhase).toBe('ACTIVE');
      expect(response.body.dayId).toBe('2026-01-28');
      expect(response.body.rosterSize).toBe(1);
    });

    it('should reject without admin key', async () => {
      const response = await request(app)
        .get('/admin/day/status');

      expect(response.status).toBe(401);
    });
  });

  describe('POST /admin/day/finalize', () => {
    it('should reject finalization before day starts', async () => {
      const response = await request(app)
        .post('/admin/day/finalize')
        .set('X-Admin-Key', ADMIN_KEY);

      expect(response.status).toBe(409);
      expect(response.body.code).toBe(ErrorCodes.DAY_NOT_STARTED);
    });

    it('should finalize day successfully', async () => {
      // Start day
      await request(app)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      // Get assignments
      const workResponse = await request(app)
        .post('/work/request')
        .send({ accountId: 'alice', nodeKey: aliceKey });

      // Submit at least one block so alice is an active contributor
      const blockId = workResponse.body.assignments[0].blockId;
      await request(app)
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

      // Finalize
      const response = await request(app)
        .post('/admin/day/finalize')
        .set('X-Admin-Key', ADMIN_KEY);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.dayId).toBe('2026-01-28');
      expect(response.body.verification.valid).toBe(true);
      expect(response.body.summary.totalEmissions).toBeGreaterThan(0);
    });

    it('should reset state after finalization', async () => {
      await request(app)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      await request(app)
        .post('/admin/day/finalize')
        .set('X-Admin-Key', ADMIN_KEY);

      expect(state.dayPhase).toBe('IDLE');
      expect(state.currentDayId).toBeNull();
      expect(state.currentRosterAccountIds).toHaveLength(0);
      expect(state.pendingSubmissions).toHaveLength(0);
    });

    it('should reject finalization without admin key', async () => {
      await request(app)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      const response = await request(app)
        .post('/admin/day/finalize');

      expect(response.status).toBe(401);
    });

    it('should increment dayNumber after finalization', async () => {
      const initialDayNumber = state.networkState.dayNumber;

      await request(app)
        .post('/admin/day/start')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ dayId: '2026-01-28' });

      await request(app)
        .post('/admin/day/finalize')
        .set('X-Admin-Key', ADMIN_KEY);

      expect(state.networkState.dayNumber).toBe(initialDayNumber + 1);
    });
  });
});

import request from 'supertest';
import { createApp } from '../app';
import { createApiState, ApiState } from '../state';
import { createInMemoryStores } from '../../persistence/inMemoryStores';
import { ErrorCodes } from '../types';

describe('/nodes endpoints', () => {
  let state: ApiState;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    const stores = createInMemoryStores();
    state = createApiState(stores);
    app = createApp(state);
  });

  describe('POST /nodes/register', () => {
    it('should register a new node successfully', async () => {
      const response = await request(app)
        .post('/nodes/register')
        .send({ accountId: 'alice' });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.accountId).toBe('alice');
      expect(response.body.nodeKey).toBeDefined();
      expect(typeof response.body.nodeKey).toBe('string');
      expect(response.body.nodeKey.length).toBeGreaterThan(0);
    });

    it('should reject duplicate registration with 409', async () => {
      await request(app)
        .post('/nodes/register')
        .send({ accountId: 'alice' });

      const response = await request(app)
        .post('/nodes/register')
        .send({ accountId: 'alice' });

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe(ErrorCodes.DUPLICATE_NODE);
    });

    it('should reject missing accountId with 400', async () => {
      const response = await request(app)
        .post('/nodes/register')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe(ErrorCodes.MISSING_ACCOUNT_ID);
    });

    it('should reject empty accountId with 400', async () => {
      const response = await request(app)
        .post('/nodes/register')
        .send({ accountId: '   ' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe(ErrorCodes.MISSING_ACCOUNT_ID);
    });

    it('should store nodeKey in state', async () => {
      const response = await request(app)
        .post('/nodes/register')
        .send({ accountId: 'bob' });

      expect(state.nodeKeys.get('bob')).toBe(response.body.nodeKey);
    });

    it('should add contributor to network state', async () => {
      await request(app)
        .post('/nodes/register')
        .send({ accountId: 'charlie' });

      expect(state.networkState.contributors.has('charlie')).toBe(true);
    });
  });

  describe('POST /nodes/heartbeat', () => {
    let nodeKey: string;

    beforeEach(async () => {
      const response = await request(app)
        .post('/nodes/register')
        .send({ accountId: 'alice' });
      nodeKey = response.body.nodeKey;
    });

    it('should acknowledge valid heartbeat', async () => {
      const response = await request(app)
        .post('/nodes/heartbeat')
        .send({ accountId: 'alice', nodeKey });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.acknowledged).toBe(true);
    });

    it('should reject heartbeat with invalid nodeKey', async () => {
      const response = await request(app)
        .post('/nodes/heartbeat')
        .send({ accountId: 'alice', nodeKey: 'wrong-key' });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe(ErrorCodes.INVALID_NODE_KEY);
    });

    it('should reject heartbeat for unknown node', async () => {
      const response = await request(app)
        .post('/nodes/heartbeat')
        .send({ accountId: 'unknown', nodeKey: 'any-key' });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe(ErrorCodes.NODE_NOT_FOUND);
    });

    it('should reject heartbeat with missing nodeKey', async () => {
      const response = await request(app)
        .post('/nodes/heartbeat')
        .send({ accountId: 'alice' });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe(ErrorCodes.INVALID_NODE_KEY);
    });

    it('should reject heartbeat with missing accountId', async () => {
      const response = await request(app)
        .post('/nodes/heartbeat')
        .send({ nodeKey });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe(ErrorCodes.MISSING_ACCOUNT_ID);
    });
  });
});

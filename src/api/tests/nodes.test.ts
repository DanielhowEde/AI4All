import request from 'supertest';
import { createApp } from '../app';
import { createApiState, ApiState } from '../state';
import { createInMemoryStores } from '../../persistence/inMemoryStores';
import { ErrorCodes } from '../types';
import { makeTestNode, signWorkerRequest, TestNode } from './helpers';

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
      const node = await makeTestNode();
      const response = await request(app)
        .post('/nodes/register')
        .send({ accountId: node.accountId, publicKey: node.publicKeyHex });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.accountId).toBe(node.accountId);
      expect(response.body.message).toBeDefined();
      // No nodeKey returned in signature-based auth
      expect(response.body.nodeKey).toBeUndefined();
    });

    it('should reject duplicate registration with 409', async () => {
      const node = await makeTestNode();
      await request(app)
        .post('/nodes/register')
        .send({ accountId: node.accountId, publicKey: node.publicKeyHex });

      const response = await request(app)
        .post('/nodes/register')
        .send({ accountId: node.accountId, publicKey: node.publicKeyHex });

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe(ErrorCodes.DUPLICATE_NODE);
    });

    it('should reject missing accountId with 400', async () => {
      const node = await makeTestNode();
      const response = await request(app)
        .post('/nodes/register')
        .send({ publicKey: node.publicKeyHex });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe(ErrorCodes.MISSING_ACCOUNT_ID);
    });

    it('should reject missing publicKey with 400', async () => {
      const node = await makeTestNode();
      const response = await request(app)
        .post('/nodes/register')
        .send({ accountId: node.accountId });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe(ErrorCodes.MISSING_PUBLIC_KEY);
    });

    it('should reject mismatched accountId/publicKey with 400', async () => {
      const node1 = await makeTestNode();
      const node2 = await makeTestNode();
      const response = await request(app)
        .post('/nodes/register')
        // node1 accountId but node2 publicKey — mismatch
        .send({ accountId: node1.accountId, publicKey: node2.publicKeyHex });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe(ErrorCodes.INVALID_SIGNATURE);
    });

    it('should store publicKey in state', async () => {
      const node = await makeTestNode();
      await request(app)
        .post('/nodes/register')
        .send({ accountId: node.accountId, publicKey: node.publicKeyHex });

      expect(state.publicKeys.get(node.accountId)).toBe(node.publicKeyHex);
    });

    it('should add contributor to network state', async () => {
      const node = await makeTestNode();
      await request(app)
        .post('/nodes/register')
        .send({ accountId: node.accountId, publicKey: node.publicKeyHex });

      expect(state.networkState.contributors.has(node.accountId)).toBe(true);
    });
  });

  describe('POST /nodes/heartbeat', () => {
    let node: TestNode;

    beforeEach(async () => {
      node = await makeTestNode();
      await request(app)
        .post('/nodes/register')
        .send({ accountId: node.accountId, publicKey: node.publicKeyHex });
    });

    it('should acknowledge valid heartbeat', async () => {
      const auth = await signWorkerRequest(node.accountId, node.secretKeyHex);
      const response = await request(app)
        .post('/nodes/heartbeat')
        .send({ accountId: node.accountId, ...auth });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.acknowledged).toBe(true);
    });

    it('should reject heartbeat with invalid signature', async () => {
      const response = await request(app)
        .post('/nodes/heartbeat')
        .send({
          accountId: node.accountId,
          timestamp: new Date().toISOString(),
          signature: 'aa'.repeat(3309), // valid hex length, wrong signature
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe(ErrorCodes.INVALID_SIGNATURE);
    });

    it('should reject heartbeat for unknown node', async () => {
      const unknown = await makeTestNode(); // not registered
      const auth = await signWorkerRequest(unknown.accountId, unknown.secretKeyHex);
      const response = await request(app)
        .post('/nodes/heartbeat')
        .send({ accountId: unknown.accountId, ...auth });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe(ErrorCodes.NODE_NOT_FOUND);
    });

    it('should reject heartbeat with missing timestamp/signature', async () => {
      const response = await request(app)
        .post('/nodes/heartbeat')
        .send({ accountId: node.accountId });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe(ErrorCodes.INVALID_SIGNATURE);
    });

    it('should reject heartbeat with missing accountId', async () => {
      const auth = await signWorkerRequest(node.accountId, node.secretKeyHex);
      const response = await request(app)
        .post('/nodes/heartbeat')
        .send(auth); // no accountId

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe(ErrorCodes.MISSING_ACCOUNT_ID);
    });
  });
});

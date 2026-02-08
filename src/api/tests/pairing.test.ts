import request from 'supertest';
import { createApp } from '../app';
import { createApiState, ApiState } from '../state';
import { createInMemoryStores } from '../../persistence/inMemoryStores';
import { ErrorCodes } from '../types';
import { generateKeyPair } from '../../crypto/keys';
import { sign } from '../../crypto/signing';
import { deriveAddress } from '../../crypto/address';

// Shared key material — WASM init is slow so we generate once
let walletPublicKey: Uint8Array;
let walletSecretKey: Uint8Array;
let walletAccountId: string;
let walletPubHex: string;

let devicePublicKey: Uint8Array;
let deviceSecretKey: Uint8Array;
let devicePubHex: string;

beforeAll(async () => {
  const walletKp = await generateKeyPair();
  walletPublicKey = walletKp.publicKey;
  walletSecretKey = walletKp.secretKey;
  walletAccountId = deriveAddress(walletPublicKey);
  walletPubHex = Buffer.from(walletPublicKey).toString('hex');

  const deviceKp = await generateKeyPair();
  devicePublicKey = deviceKp.publicKey;
  deviceSecretKey = deviceKp.secretKey;
  devicePubHex = Buffer.from(devicePublicKey).toString('hex');
}, 60_000);

describe('/pairing endpoints', () => {
  let state: ApiState;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    const stores = createInMemoryStores();
    state = createApiState(stores);
    app = createApp(state);
  });

  // ========================================================================
  // POST /pairing/start
  // ========================================================================
  describe('POST /pairing/start', () => {
    it('should create a pairing session', async () => {
      const res = await request(app)
        .post('/pairing/start')
        .send({ devicePublicKey: devicePubHex, deviceName: 'Test Worker' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.pairingId).toBeDefined();
      expect(res.body.pairingCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(res.body.verificationCode).toMatch(/^\d{4}$/);
      expect(res.body.expiresAt).toBeDefined();
    });

    it('should reject missing devicePublicKey', async () => {
      const res = await request(app)
        .post('/pairing/start')
        .send({ deviceName: 'Test Worker' });

      expect(res.status).toBe(400);
    });

    it('should reject invalid public key length', async () => {
      const res = await request(app)
        .post('/pairing/start')
        .send({ devicePublicKey: 'abcd', deviceName: 'Test' });

      expect(res.status).toBe(400);
    });

    it('should rate limit after too many pending pairings', async () => {
      // Create 10 pairings (the limit)
      for (let i = 0; i < 10; i++) {
        const kp = await generateKeyPair();
        const hex = Buffer.from(kp.publicKey).toString('hex');
        await request(app)
          .post('/pairing/start')
          .send({ devicePublicKey: hex, deviceName: `Worker ${i}` });
      }

      const res = await request(app)
        .post('/pairing/start')
        .send({ devicePublicKey: devicePubHex, deviceName: 'Over limit' });

      expect(res.status).toBe(429);
      expect(res.body.code).toBe(ErrorCodes.PAIRING_RATE_LIMITED);
    }, 120_000);
  });

  // ========================================================================
  // GET /pairing/code/:code
  // ========================================================================
  describe('GET /pairing/code/:code', () => {
    it('should resolve a short code to pairing details', async () => {
      const start = await request(app)
        .post('/pairing/start')
        .send({ devicePublicKey: devicePubHex, deviceName: 'Test Worker' });

      const res = await request(app)
        .get(`/pairing/code/${start.body.pairingCode}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.pairingId).toBe(start.body.pairingId);
      expect(res.body.deviceName).toBe('Test Worker');
      expect(res.body.verificationCode).toBe(start.body.verificationCode);
    });

    it('should return 404 for unknown code', async () => {
      const res = await request(app).get('/pairing/code/ZZZZ-ZZZZ');

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ErrorCodes.PAIRING_NOT_FOUND);
    });
  });

  // ========================================================================
  // GET /pairing/:pairingId
  // ========================================================================
  describe('GET /pairing/:pairingId', () => {
    it('should return pairing details by ID', async () => {
      const start = await request(app)
        .post('/pairing/start')
        .send({ devicePublicKey: devicePubHex, deviceName: 'Test Worker' });

      const res = await request(app)
        .get(`/pairing/${start.body.pairingId}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe('PENDING');
    });

    it('should return 404 for unknown pairing', async () => {
      const res = await request(app)
        .get('/pairing/00000000-0000-0000-0000-000000000000');

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /pairing/approve
  // ========================================================================
  describe('POST /pairing/approve', () => {
    let pairingId: string;

    beforeEach(async () => {
      const start = await request(app)
        .post('/pairing/start')
        .send({ devicePublicKey: devicePubHex, deviceName: 'Test Worker' });
      pairingId = start.body.pairingId;
    });

    it('should approve with valid wallet signature', async () => {
      const timestamp = new Date().toISOString();
      const nonce = 'test-nonce-123';
      const payload = `AI4A:PAIR:APPROVE:v1${pairingId}${timestamp}${nonce}`;
      const payloadBytes = new TextEncoder().encode(payload);
      const signature = await sign(payloadBytes, walletSecretKey);
      const sigHex = Buffer.from(signature).toString('hex');

      const res = await request(app)
        .post('/pairing/approve')
        .send({
          pairingId,
          accountId: walletAccountId,
          walletPublicKey: walletPubHex,
          signature: sigHex,
          timestamp,
          nonce,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe('APPROVED');

      // Session should now be APPROVED with a challenge
      const session = state.pairings.get(pairingId)!;
      expect(session.status).toBe('APPROVED');
      expect(session.challenge).toBeDefined();
      expect(session.approvedBy).toBe(walletAccountId);
    }, 30_000);

    it('should reject when walletPublicKey does not match accountId', async () => {
      const timestamp = new Date().toISOString();
      const nonce = 'test-nonce';
      const payload = `AI4A:PAIR:APPROVE:v1${pairingId}${timestamp}${nonce}`;
      const payloadBytes = new TextEncoder().encode(payload);
      const signature = await sign(payloadBytes, walletSecretKey);
      const sigHex = Buffer.from(signature).toString('hex');

      const res = await request(app)
        .post('/pairing/approve')
        .send({
          pairingId,
          accountId: 'ai4a_wrong_account_id_here_0000000000000000',
          walletPublicKey: walletPubHex,
          signature: sigHex,
          timestamp,
          nonce,
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(ErrorCodes.PAIRING_SIGNATURE_INVALID);
    }, 30_000);

    it('should reject a tampered signature', async () => {
      const timestamp = new Date().toISOString();
      const nonce = 'test-nonce';
      const payload = `AI4A:PAIR:APPROVE:v1${pairingId}${timestamp}${nonce}`;
      const payloadBytes = new TextEncoder().encode(payload);
      const signature = await sign(payloadBytes, walletSecretKey);
      const tampered = new Uint8Array(signature);
      tampered[100] ^= 0xff;
      const sigHex = Buffer.from(tampered).toString('hex');

      const res = await request(app)
        .post('/pairing/approve')
        .send({
          pairingId,
          accountId: walletAccountId,
          walletPublicKey: walletPubHex,
          signature: sigHex,
          timestamp,
          nonce,
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(ErrorCodes.PAIRING_SIGNATURE_INVALID);
    }, 30_000);

    it('should reject approve on expired pairing', async () => {
      // Manually expire the session
      const session = state.pairings.get(pairingId)!;
      session.expiresAt = new Date(Date.now() - 1000);

      const timestamp = new Date().toISOString();
      const nonce = 'test-nonce';
      const payload = `AI4A:PAIR:APPROVE:v1${pairingId}${timestamp}${nonce}`;
      const payloadBytes = new TextEncoder().encode(payload);
      const signature = await sign(payloadBytes, walletSecretKey);
      const sigHex = Buffer.from(signature).toString('hex');

      const res = await request(app)
        .post('/pairing/approve')
        .send({
          pairingId,
          accountId: walletAccountId,
          walletPublicKey: walletPubHex,
          signature: sigHex,
          timestamp,
          nonce,
        });

      expect(res.status).toBe(410);
      expect(res.body.code).toBe(ErrorCodes.PAIRING_EXPIRED);
    }, 30_000);
  });

  // ========================================================================
  // GET /pairing/:pairingId/status
  // ========================================================================
  describe('GET /pairing/:pairingId/status', () => {
    it('should return PENDING initially', async () => {
      const start = await request(app)
        .post('/pairing/start')
        .send({ devicePublicKey: devicePubHex, deviceName: 'Test Worker' });

      const res = await request(app)
        .get(`/pairing/${start.body.pairingId}/status`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('PENDING');
      expect(res.body.challenge).toBeUndefined();
    });

    it('should return APPROVED with challenge after approval', async () => {
      const start = await request(app)
        .post('/pairing/start')
        .send({ devicePublicKey: devicePubHex, deviceName: 'Test Worker' });

      // Approve
      const timestamp = new Date().toISOString();
      const nonce = 'nonce';
      const payload = `AI4A:PAIR:APPROVE:v1${start.body.pairingId}${timestamp}${nonce}`;
      const payloadBytes = new TextEncoder().encode(payload);
      const signature = await sign(payloadBytes, walletSecretKey);
      const sigHex = Buffer.from(signature).toString('hex');

      await request(app)
        .post('/pairing/approve')
        .send({
          pairingId: start.body.pairingId,
          accountId: walletAccountId,
          walletPublicKey: walletPubHex,
          signature: sigHex,
          timestamp,
          nonce,
        });

      const res = await request(app)
        .get(`/pairing/${start.body.pairingId}/status`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('APPROVED');
      expect(res.body.challenge).toBeDefined();
      expect(typeof res.body.challenge).toBe('string');
      expect(res.body.accountId).toBe(walletAccountId);
    }, 30_000);
  });

  // ========================================================================
  // POST /pairing/complete
  // ========================================================================
  describe('POST /pairing/complete', () => {
    it('should complete the full pairing flow', async () => {
      // Step 1: Worker starts pairing
      const start = await request(app)
        .post('/pairing/start')
        .send({ devicePublicKey: devicePubHex, deviceName: 'Test Worker' });

      const pairingId = start.body.pairingId;

      // Step 2: Phone approves
      const timestamp = new Date().toISOString();
      const nonce = 'nonce-abc';
      const approvePayload = `AI4A:PAIR:APPROVE:v1${pairingId}${timestamp}${nonce}`;
      const approveBytes = new TextEncoder().encode(approvePayload);
      const approveSig = await sign(approveBytes, walletSecretKey);

      await request(app)
        .post('/pairing/approve')
        .send({
          pairingId,
          accountId: walletAccountId,
          walletPublicKey: walletPubHex,
          signature: Buffer.from(approveSig).toString('hex'),
          timestamp,
          nonce,
        });

      // Step 3: Worker polls and gets challenge
      const statusRes = await request(app)
        .get(`/pairing/${pairingId}/status`);

      expect(statusRes.body.status).toBe('APPROVED');
      const challenge = statusRes.body.challenge;

      // Step 4: Worker signs challenge with device key
      const challengeBytes = Buffer.from(challenge, 'hex');
      const deviceSig = await sign(new Uint8Array(challengeBytes), deviceSecretKey);

      const completeRes = await request(app)
        .post('/pairing/complete')
        .send({
          pairingId,
          signature: Buffer.from(deviceSig).toString('hex'),
        });

      expect(completeRes.status).toBe(200);
      expect(completeRes.body.success).toBe(true);
      expect(completeRes.body.deviceId).toBeDefined();
      expect(completeRes.body.accountId).toBe(walletAccountId);

      // Verify device is stored
      const device = state.devices.get(completeRes.body.deviceId);
      expect(device).toBeDefined();
      expect(device!.accountId).toBe(walletAccountId);
      expect(device!.devicePublicKey).toBe(devicePubHex);

      // Verify account has device linked
      const deviceIds = state.accountDevices.get(walletAccountId);
      expect(deviceIds).toContain(completeRes.body.deviceId);

      // Verify contributor was auto-registered
      expect(state.networkState.contributors.has(walletAccountId)).toBe(true);

      // Verify session is COMPLETED
      const session = state.pairings.get(pairingId)!;
      expect(session.status).toBe('COMPLETED');
    }, 60_000);

    it('should reject complete with wrong device signature', async () => {
      // Start + approve
      const start = await request(app)
        .post('/pairing/start')
        .send({ devicePublicKey: devicePubHex, deviceName: 'Test Worker' });

      const pairingId = start.body.pairingId;
      const timestamp = new Date().toISOString();
      const nonce = 'nonce';
      const approvePayload = `AI4A:PAIR:APPROVE:v1${pairingId}${timestamp}${nonce}`;
      const approveSig = await sign(new TextEncoder().encode(approvePayload), walletSecretKey);

      await request(app)
        .post('/pairing/approve')
        .send({
          pairingId,
          accountId: walletAccountId,
          walletPublicKey: walletPubHex,
          signature: Buffer.from(approveSig).toString('hex'),
          timestamp,
          nonce,
        });

      // Complete with wallet key instead of device key (wrong key)
      const statusRes = await request(app).get(`/pairing/${pairingId}/status`);
      const challenge = statusRes.body.challenge;
      const challengeBytes = Buffer.from(challenge, 'hex');
      const wrongSig = await sign(new Uint8Array(challengeBytes), walletSecretKey); // wrong key!

      const res = await request(app)
        .post('/pairing/complete')
        .send({
          pairingId,
          signature: Buffer.from(wrongSig).toString('hex'),
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(ErrorCodes.DEVICE_SIGNATURE_INVALID);
    }, 60_000);

    it('should reject complete on non-APPROVED session', async () => {
      const start = await request(app)
        .post('/pairing/start')
        .send({ devicePublicKey: devicePubHex, deviceName: 'Test Worker' });

      const res = await request(app)
        .post('/pairing/complete')
        .send({
          pairingId: start.body.pairingId,
          signature: 'deadbeef'.repeat(100),
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ErrorCodes.PAIRING_INVALID_STATE);
    });
  });
});

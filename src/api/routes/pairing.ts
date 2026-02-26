import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import { ApiState } from '../state';
import {
  PairingStartRequest,
  PairingStartResponse,
  PairingDetailsResponse,
  PairingApproveRequest,
  PairingApproveResponse,
  PairingStatusResponse,
  PairingCompleteRequest,
  PairingCompleteResponse,
  PairingSession,
  LinkedDevice,
  ErrorCodes,
} from '../types';
import { verify } from '../../crypto/signing';
import { deriveAddress } from '../../crypto/address';

// ============================================================================
// Constants
// ============================================================================

const PAIRING_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_PENDING_PAIRINGS = 10;
const PAIRING_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1

// ============================================================================
// Helpers
// ============================================================================

/** Generate a short pairing code like "K7F9-M2Q4" */
function generatePairingCode(): string {
  const chars = PAIRING_CODE_CHARS;
  let code = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
    if (i === 3) code += '-';
  }
  return code;
}

/** Generate a 4-digit verification code */
function generateVerificationCode(): string {
  const num = crypto.randomInt(0, 10000);
  return num.toString().padStart(4, '0');
}

/** Check if a pairing session has expired */
function isExpired(session: PairingSession): boolean {
  return new Date() > session.expiresAt;
}

/** Expire stale sessions and free their codes */
function expireStale(state: ApiState): void {
  const now = new Date();
  for (const [, session] of state.pairings) {
    if (session.status === 'PENDING' && now > session.expiresAt) {
      session.status = 'EXPIRED';
      state.pairingCodeIndex.delete(session.pairingCode);
    }
  }
}

/** Count active PENDING pairings */
function countPending(state: ApiState): number {
  let count = 0;
  for (const session of state.pairings.values()) {
    if (session.status === 'PENDING') count++;
  }
  return count;
}

/** Convert hex string to Uint8Array */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ============================================================================
// Router
// ============================================================================

export function createPairingRouter(state: ApiState): Router {
  const router = Router();

  // --------------------------------------------------------------------------
  // POST /pairing/start — Worker initiates pairing
  // --------------------------------------------------------------------------
  router.post('/start', (req: Request, res: Response) => {
    const body = req.body as PairingStartRequest;

    // Validate required fields
    if (!body.devicePublicKey || typeof body.devicePublicKey !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Missing devicePublicKey',
        code: ErrorCodes.INTERNAL_ERROR,
      });
      return;
    }

    if (!body.deviceName || typeof body.deviceName !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Missing deviceName',
        code: ErrorCodes.INTERNAL_ERROR,
      });
      return;
    }

    // Validate public key length (ML-DSA-65: 1952 bytes = 3904 hex chars)
    if (body.devicePublicKey.length !== 3904 || !/^[0-9a-fA-F]+$/.test(body.devicePublicKey)) {
      res.status(400).json({
        success: false,
        error: 'Invalid devicePublicKey: expected 3904 hex characters (ML-DSA-65)',
        code: ErrorCodes.INTERNAL_ERROR,
      });
      return;
    }

    // Expire stale sessions first
    expireStale(state);

    // Rate limit
    if (countPending(state) >= MAX_PENDING_PAIRINGS) {
      res.status(429).json({
        success: false,
        error: 'Too many pending pairings',
        code: ErrorCodes.PAIRING_RATE_LIMITED,
      });
      return;
    }

    // Generate unique pairing code (retry if collision)
    let pairingCode: string;
    let attempts = 0;
    do {
      pairingCode = generatePairingCode();
      attempts++;
    } while (state.pairingCodeIndex.has(pairingCode) && attempts < 100);

    if (state.pairingCodeIndex.has(pairingCode)) {
      res.status(500).json({
        success: false,
        error: 'Could not generate unique pairing code',
        code: ErrorCodes.INTERNAL_ERROR,
      });
      return;
    }

    const now = new Date();
    const pairingId = crypto.randomUUID();
    const verificationCode = generateVerificationCode();

    const session: PairingSession = {
      pairingId,
      pairingCode,
      verificationCode,
      status: 'PENDING',
      devicePublicKey: body.devicePublicKey.toLowerCase(),
      deviceName: body.deviceName.trim(),
      capabilities: body.capabilities ?? {},
      createdAt: now,
      expiresAt: new Date(now.getTime() + PAIRING_TTL_MS),
    };

    state.pairings.set(pairingId, session);
    state.pairingCodeIndex.set(pairingCode, pairingId);

    const response: PairingStartResponse = {
      success: true,
      pairingId,
      pairingCode,
      verificationCode,
      expiresAt: session.expiresAt.toISOString(),
    };

    res.status(201).json(response);
  });

  // --------------------------------------------------------------------------
  // GET /pairing/code/:code — Resolve short code to pairing details (Phone)
  // --------------------------------------------------------------------------
  router.get('/code/:code', (req: Request, res: Response) => {
    const code = (req.params.code as string).toUpperCase();

    // Expire stale sessions first
    expireStale(state);

    const pairingId = state.pairingCodeIndex.get(code);
    if (!pairingId) {
      res.status(404).json({
        success: false,
        error: 'Pairing code not found or expired',
        code: ErrorCodes.PAIRING_NOT_FOUND,
      });
      return;
    }

    const session = state.pairings.get(pairingId);
    if (!session || isExpired(session)) {
      res.status(404).json({
        success: false,
        error: 'Pairing expired',
        code: ErrorCodes.PAIRING_EXPIRED,
      });
      return;
    }

    const response: PairingDetailsResponse = {
      success: true,
      pairingId: session.pairingId,
      status: session.status,
      deviceName: session.deviceName,
      capabilities: session.capabilities,
      verificationCode: session.verificationCode,
      expiresAt: session.expiresAt.toISOString(),
    };

    res.status(200).json(response);
  });

  // --------------------------------------------------------------------------
  // GET /pairing/:pairingId — Get pairing details by ID (Phone via QR)
  // --------------------------------------------------------------------------
  router.get('/:pairingId', (req: Request, res: Response) => {
    const pairingId = req.params.pairingId as string;

    const session = state.pairings.get(pairingId);
    if (!session) {
      res.status(404).json({
        success: false,
        error: 'Pairing not found',
        code: ErrorCodes.PAIRING_NOT_FOUND,
      });
      return;
    }

    if (isExpired(session) && session.status === 'PENDING') {
      session.status = 'EXPIRED';
      state.pairingCodeIndex.delete(session.pairingCode);
    }

    const response: PairingDetailsResponse = {
      success: true,
      pairingId: session.pairingId,
      status: session.status,
      deviceName: session.deviceName,
      capabilities: session.capabilities,
      verificationCode: session.verificationCode,
      expiresAt: session.expiresAt.toISOString(),
    };

    res.status(200).json(response);
  });

  // --------------------------------------------------------------------------
  // POST /pairing/approve — Phone approves pairing with wallet signature
  // --------------------------------------------------------------------------
  router.post('/approve', async (req: Request, res: Response) => {
    const body = req.body as PairingApproveRequest;

    // Validate required fields
    if (!body.pairingId || !body.accountId || !body.walletPublicKey || !body.signature || !body.timestamp || !body.nonce) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: pairingId, accountId, walletPublicKey, signature, timestamp, nonce',
        code: ErrorCodes.INTERNAL_ERROR,
      });
      return;
    }

    const session = state.pairings.get(body.pairingId);
    if (!session) {
      res.status(404).json({
        success: false,
        error: 'Pairing not found',
        code: ErrorCodes.PAIRING_NOT_FOUND,
      });
      return;
    }

    // Check expiry
    if (isExpired(session)) {
      session.status = 'EXPIRED';
      state.pairingCodeIndex.delete(session.pairingCode);
      res.status(410).json({
        success: false,
        error: 'Pairing expired',
        code: ErrorCodes.PAIRING_EXPIRED,
      });
      return;
    }

    // Must be PENDING
    if (session.status !== 'PENDING') {
      res.status(409).json({
        success: false,
        error: `Pairing is ${session.status}, expected PENDING`,
        code: ErrorCodes.PAIRING_INVALID_STATE,
      });
      return;
    }

    // Self-authenticating: verify deriveAddress(walletPublicKey) === accountId
    let walletPkBytes: Uint8Array;
    try {
      walletPkBytes = hexToBytes(body.walletPublicKey);
    } catch {
      res.status(400).json({
        success: false,
        error: 'Invalid walletPublicKey hex',
        code: ErrorCodes.PAIRING_SIGNATURE_INVALID,
      });
      return;
    }

    const derivedAddress = deriveAddress(walletPkBytes);
    if (derivedAddress !== body.accountId) {
      res.status(403).json({
        success: false,
        error: 'walletPublicKey does not match accountId',
        code: ErrorCodes.PAIRING_SIGNATURE_INVALID,
      });
      return;
    }

    // Verify signature: payload = "AI4A:PAIR:APPROVE:v1" + pairingId + timestamp + nonce
    const payload = `AI4A:PAIR:APPROVE:v1${body.pairingId}${body.timestamp}${body.nonce}`;
    const payloadBytes = new TextEncoder().encode(payload);
    let sigBytes: Uint8Array;
    try {
      sigBytes = hexToBytes(body.signature);
    } catch {
      res.status(400).json({
        success: false,
        error: 'Invalid signature hex',
        code: ErrorCodes.PAIRING_SIGNATURE_INVALID,
      });
      return;
    }

    try {
      const valid = await verify(payloadBytes, sigBytes, walletPkBytes);
      if (!valid) {
        res.status(403).json({
          success: false,
          error: 'Signature verification failed',
          code: ErrorCodes.PAIRING_SIGNATURE_INVALID,
        });
        return;
      }
    } catch {
      res.status(500).json({
        success: false,
        error: 'Signature verification error',
        code: ErrorCodes.INTERNAL_ERROR,
      });
      return;
    }

    // Approval granted — generate challenge for the worker
    const challenge = crypto.randomBytes(32).toString('hex');
    session.status = 'APPROVED';
    session.approvedBy = body.accountId;
    session.challenge = challenge;

    // Remove from code index (one-time use)
    state.pairingCodeIndex.delete(session.pairingCode);

    const response: PairingApproveResponse = {
      success: true,
      status: 'APPROVED',
    };

    res.status(200).json(response);
  });

  // --------------------------------------------------------------------------
  // GET /pairing/:pairingId/status — Worker polls for approval
  // --------------------------------------------------------------------------
  router.get('/:pairingId/status', (req: Request, res: Response) => {
    const pairingId = req.params.pairingId as string;

    const session = state.pairings.get(pairingId);
    if (!session) {
      res.status(404).json({
        success: false,
        error: 'Pairing not found',
        code: ErrorCodes.PAIRING_NOT_FOUND,
      });
      return;
    }

    // Auto-expire
    if (session.status === 'PENDING' && isExpired(session)) {
      session.status = 'EXPIRED';
      state.pairingCodeIndex.delete(session.pairingCode);
    }

    const response: PairingStatusResponse = {
      success: true,
      status: session.status,
      ...(session.status === 'APPROVED' && {
        challenge: session.challenge,
        accountId: session.approvedBy,
      }),
    };

    res.status(200).json(response);
  });

  // --------------------------------------------------------------------------
  // POST /pairing/complete — Worker completes pairing with device signature
  // --------------------------------------------------------------------------
  router.post('/complete', async (req: Request, res: Response) => {
    const body = req.body as PairingCompleteRequest;

    if (!body.pairingId || !body.signature) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: pairingId, signature',
        code: ErrorCodes.INTERNAL_ERROR,
      });
      return;
    }

    const session = state.pairings.get(body.pairingId);
    if (!session) {
      res.status(404).json({
        success: false,
        error: 'Pairing not found',
        code: ErrorCodes.PAIRING_NOT_FOUND,
      });
      return;
    }

    // Must be APPROVED
    if (session.status !== 'APPROVED') {
      res.status(409).json({
        success: false,
        error: `Pairing is ${session.status}, expected APPROVED`,
        code: ErrorCodes.PAIRING_INVALID_STATE,
      });
      return;
    }

    if (!session.challenge || !session.approvedBy) {
      res.status(500).json({
        success: false,
        error: 'Pairing state corrupted: missing challenge or approvedBy',
        code: ErrorCodes.INTERNAL_ERROR,
      });
      return;
    }

    // Verify device signature on the challenge
    const challengeBytes = hexToBytes(session.challenge);
    const devicePkBytes = hexToBytes(session.devicePublicKey);
    let sigBytes: Uint8Array;
    try {
      sigBytes = hexToBytes(body.signature);
    } catch {
      res.status(400).json({
        success: false,
        error: 'Invalid signature hex',
        code: ErrorCodes.DEVICE_SIGNATURE_INVALID,
      });
      return;
    }

    try {
      const valid = await verify(challengeBytes, sigBytes, devicePkBytes);
      if (!valid) {
        res.status(403).json({
          success: false,
          error: 'Device signature verification failed',
          code: ErrorCodes.DEVICE_SIGNATURE_INVALID,
        });
        return;
      }
    } catch {
      res.status(500).json({
        success: false,
        error: 'Device signature verification error',
        code: ErrorCodes.INTERNAL_ERROR,
      });
      return;
    }

    // Pairing complete — create linked device
    const deviceId = crypto.randomUUID();
    const accountId = session.approvedBy;

    const device: LinkedDevice = {
      deviceId,
      accountId,
      devicePublicKey: session.devicePublicKey,
      deviceName: session.deviceName,
      capabilities: session.capabilities,
      linkedAt: new Date().toISOString(),
    };

    state.devices.set(deviceId, device);

    // Update account → devices index
    const existing = state.accountDevices.get(accountId) ?? [];
    existing.push(deviceId);
    state.accountDevices.set(accountId, existing);

    // Mark session complete
    session.status = 'COMPLETED';

    // Auto-register the account as a contributor if not already present
    if (!state.networkState.contributors.has(accountId)) {
      const { registerNode } = await import('../../services/nodeService');
      const { state: newState } = registerNode(state.networkState, { accountId }, new Date());
      state.networkState = newState;
    }

    const response: PairingCompleteResponse = {
      success: true,
      deviceId,
      accountId,
    };

    res.status(200).json(response);
  });

  return router;
}

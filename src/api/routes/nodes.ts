import { Router, Request, Response } from 'express';
import * as nodeCrypto from 'crypto';
import { ApiState } from '../state';
import {
  RegisterNodeRequest,
  RegisterNodeResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  ErrorCodes,
} from '../types';
import { registerNode } from '../../services/nodeService';
import { verifyWorkerAuth } from '../auth';

/**
 * Create router for node endpoints
 */
export function createNodesRouter(state: ApiState): Router {
  const router = Router();

  /**
   * POST /nodes/register
   * Register a new node by providing its ML-DSA-65 public key.
   * No secret is issued — future requests are authenticated by signature.
   */
  router.post('/register', (req: Request, res: Response) => {
    const body = req.body as RegisterNodeRequest;

    if (!body.accountId || typeof body.accountId !== 'string' || body.accountId.trim() === '') {
      res.status(400).json({
        success: false,
        error: 'Missing or invalid accountId',
        code: ErrorCodes.MISSING_ACCOUNT_ID,
      });
      return;
    }

    if (!body.publicKey || typeof body.publicKey !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Missing publicKey (hex-encoded ML-DSA-65 public key)',
        code: ErrorCodes.MISSING_PUBLIC_KEY,
      });
      return;
    }

    const accountId = body.accountId.trim();

    // Validate address derivation: "ai4a" + hex(SHA256(pk)[0:20])
    try {
      const pkBytes = Buffer.from(body.publicKey, 'hex');
      const hash = nodeCrypto.createHash('sha256').update(pkBytes).digest('hex');
      const expectedAddress = 'ai4a' + hash.slice(0, 40);
      if (expectedAddress !== accountId) {
        res.status(400).json({
          success: false,
          error: 'accountId does not match public key (expected ai4a + SHA256(pk)[0:20])',
          code: ErrorCodes.INVALID_SIGNATURE,
        });
        return;
      }
    } catch {
      res.status(400).json({
        success: false,
        error: 'Invalid publicKey: must be valid hex',
        code: ErrorCodes.MISSING_PUBLIC_KEY,
      });
      return;
    }

    // Check for duplicate registration
    if (state.publicKeys.has(accountId)) {
      res.status(409).json({
        success: false,
        error: `Node already registered: ${accountId}`,
        code: ErrorCodes.DUPLICATE_NODE,
      });
      return;
    }

    // Register node in network state
    const { state: newState } = registerNode(state.networkState, { accountId }, new Date());
    state.networkState = newState;

    // Store public key for signature verification
    state.publicKeys.set(accountId, body.publicKey);

    // Persist if available
    if (state.operationalStore) {
      state.operationalStore.savePublicKeys(state.publicKeys);
    }

    const response: RegisterNodeResponse = {
      success: true,
      accountId,
      message: 'Node registered successfully',
    };

    res.status(201).json(response);
  });

  /**
   * POST /nodes/heartbeat
   * Update node liveness — authenticated by ML-DSA-65 signature.
   */
  router.post('/heartbeat', async (req: Request, res: Response) => {
    const body = req.body as HeartbeatRequest;

    if (!body.accountId || typeof body.accountId !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Missing accountId',
        code: ErrorCodes.MISSING_ACCOUNT_ID,
      });
      return;
    }

    const accountId = body.accountId.trim();

    const ok = await verifyWorkerAuth(
      state.publicKeys,
      accountId,
      body.timestamp,
      body.signature,
      res,
    );
    if (!ok) return;

    // Update lastSeenAt for liveness tracking
    const contributor = state.networkState.contributors.get(accountId);
    if (contributor) {
      contributor.lastSeenAt = new Date();
    }

    const response: HeartbeatResponse = {
      success: true,
      acknowledged: true,
    };

    res.status(200).json(response);
  });

  return router;
}

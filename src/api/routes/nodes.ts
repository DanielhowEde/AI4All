import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import { ApiState } from '../state';
import {
  RegisterNodeRequest,
  RegisterNodeResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  ErrorCodes,
} from '../types';
import { registerNode } from '../../services/nodeService';
import { buildWalletBlock } from '../../chain/chainBuilder';
import type { WalletEvent } from '../../chain/types';

/**
 * Create router for node endpoints
 */
export function createNodesRouter(state: ApiState): Router {
  const router = Router();

  /**
   * POST /nodes/register
   * Register a new node and receive a nodeKey for authentication
   */
  router.post('/register', (req: Request, res: Response) => {
    const body = req.body as RegisterNodeRequest;

    // Validate required fields
    if (!body.accountId || typeof body.accountId !== 'string' || body.accountId.trim() === '') {
      res.status(400).json({
        success: false,
        error: 'Missing or invalid accountId',
        code: ErrorCodes.MISSING_ACCOUNT_ID,
      });
      return;
    }

    const accountId = body.accountId.trim();

    // Check for duplicate registration
    if (state.networkState.contributors.has(accountId)) {
      res.status(409).json({
        success: false,
        error: `Node already registered: ${accountId}`,
        code: ErrorCodes.DUPLICATE_NODE,
      });
      return;
    }

    // Generate nodeKey
    const nodeKey = crypto.randomUUID();

    // Register node in network state
    const { state: newState } = registerNode(state.networkState, { accountId }, new Date());
    state.networkState = newState;

    // Store nodeKey for authentication
    state.nodeKeys.set(accountId, nodeKey);

    // Persist to SQLite if available
    if (state.kvStore) {
      state.kvStore.saveNodeKeys(state.nodeKeys);
    }

    // Create wallet chain genesis block for this account
    if (state.chainStore) {
      const walletEvent: WalletEvent = {
        eventType: 'WALLET_CREATED',
        timestamp: new Date().toISOString(),
        payload: { accountId },
      };

      // Build unsigned wallet block (publicKey supplied if available)
      const publicKey = (body as { publicKey?: string }).publicKey || '';
      const walletBlock = buildWalletBlock({
        walletAddress: accountId,
        publicKey,
        events: [walletEvent],
      });

      state.chainStore.appendWalletBlock({
        ...walletBlock,
        signature: '', // Unsigned for nodeKey-auth registrations
      });
    }

    const response: RegisterNodeResponse = {
      success: true,
      accountId,
      nodeKey,
      message: 'Node registered successfully',
    };

    res.status(201).json(response);
  });

  /**
   * POST /nodes/heartbeat
   * Update node liveness (for future use)
   */
  router.post('/heartbeat', (req: Request, res: Response) => {
    const body = req.body as HeartbeatRequest;

    // Validate required fields
    if (!body.accountId || typeof body.accountId !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Missing accountId',
        code: ErrorCodes.MISSING_ACCOUNT_ID,
      });
      return;
    }

    if (!body.nodeKey || typeof body.nodeKey !== 'string') {
      res.status(401).json({
        success: false,
        error: 'Missing nodeKey',
        code: ErrorCodes.INVALID_NODE_KEY,
      });
      return;
    }

    const accountId = body.accountId.trim();

    // Check if node exists
    if (!state.networkState.contributors.has(accountId)) {
      res.status(404).json({
        success: false,
        error: `Node not found: ${accountId}`,
        code: ErrorCodes.NODE_NOT_FOUND,
      });
      return;
    }

    // Validate nodeKey
    const storedKey = state.nodeKeys.get(accountId);
    if (storedKey !== body.nodeKey) {
      res.status(401).json({
        success: false,
        error: 'Invalid nodeKey',
        code: ErrorCodes.INVALID_NODE_KEY,
      });
      return;
    }

    // Update lastSeenAt (for future liveness tracking)
    // For now, we just acknowledge the heartbeat
    // In future: update contributor.lastSeenAt in state

    const response: HeartbeatResponse = {
      success: true,
      acknowledged: true,
    };

    res.status(200).json(response);
  });

  return router;
}

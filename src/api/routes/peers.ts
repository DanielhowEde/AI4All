import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import { ApiState } from '../state';
import {
  PeerRegisterRequest,
  PeerRegisterResponse,
  PeerDirectoryResponse,
  PeerInfo,
  ErrorCodes,
} from '../types';
import { verifyWorkerAuth } from '../auth';

/**
 * Create router for peer discovery endpoints
 */
export function createPeersRouter(state: ApiState): Router {
  const router = Router();

  /**
   * POST /peers/register
   * Worker announces its P2P listen address and capabilities.
   * Returns a workerId for use in P2P communications.
   */
  router.post('/register', async (req: Request, res: Response) => {
    const body = req.body as PeerRegisterRequest;

    if (!body.accountId || typeof body.accountId !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Missing accountId',
        code: ErrorCodes.MISSING_ACCOUNT_ID,
      });
      return;
    }

    if (!body.listenAddr || typeof body.listenAddr !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Missing listenAddr',
        code: ErrorCodes.INTERNAL_ERROR,
      });
      return;
    }

    const accountId = body.accountId.trim();

    // Verify ML-DSA-65 signature
    const ok = await verifyWorkerAuth(
      state.publicKeys,
      accountId,
      body.timestamp,
      body.signature,
      res,
    );
    if (!ok) return;

    // Generate deterministic workerId from accountId
    const workerId = `worker-${crypto.createHash('sha256').update(accountId).digest('hex').substring(0, 8)}`;

    const peerInfo: PeerInfo = {
      workerId,
      accountId,
      listenAddr: body.listenAddr,
      capabilities: body.capabilities ?? {
        supportedTasks: [],
        maxConcurrentTasks: 1,
        availableMemoryMb: 0,
        gpuAvailable: false,
        maxContextLength: 4096,
        workerVersion: 'unknown',
      },
      lastSeen: new Date().toISOString(),
    };

    state.peers.set(workerId, peerInfo);

    const response: PeerRegisterResponse = {
      success: true,
      workerId,
    };

    res.status(200).json(response);
  });

  /**
   * GET /peers/directory
   * Returns live registered peers. Workers call this after registration
   * to discover other workers for direct P2P connections.
   *
   * Query params:
   *   ?exclude=<workerId>    — exclude self from the listing
   *   ?staleTtlSecs=<n>      — override staleness threshold (default 300s)
   */
  router.get('/directory', (req: Request, res: Response) => {
    const exclude = req.query.exclude as string | undefined;
    const staleTtlSecs = parseInt(req.query.staleTtlSecs as string, 10) || 300;
    const cutoff = new Date(Date.now() - staleTtlSecs * 1000).toISOString();

    const peers: PeerInfo[] = [];
    for (const [, peer] of state.peers) {
      if (exclude && peer.workerId === exclude) continue;
      if (peer.lastSeen < cutoff) continue; // Skip stale peers
      peers.push(peer);
    }

    const response: PeerDirectoryResponse = {
      success: true,
      peers,
    };

    res.status(200).json(response);
  });

  /**
   * POST /peers/heartbeat
   * Worker updates its liveness. Keeps the peer entry fresh so it
   * doesn't get pruned by stale-peer cleanup.
   */
  router.post('/heartbeat', (req: Request, res: Response) => {
    const { workerId } = req.body as { workerId: string };

    if (!workerId || typeof workerId !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Missing workerId',
        code: ErrorCodes.PEER_NOT_FOUND,
      });
      return;
    }

    const peer = state.peers.get(workerId);
    if (!peer) {
      res.status(404).json({
        success: false,
        error: `Peer not found: ${workerId}`,
        code: ErrorCodes.PEER_NOT_FOUND,
      });
      return;
    }

    peer.lastSeen = new Date().toISOString();
    state.peers.set(workerId, peer);

    res.status(200).json({ success: true, acknowledged: true });
  });

  /**
   * DELETE /peers/:workerId
   * Worker deregisters itself (graceful shutdown).
   */
  router.delete('/:workerId', (req: Request, res: Response) => {
    const workerId = req.params.workerId as string;

    if (!state.peers.has(workerId)) {
      res.status(404).json({
        success: false,
        error: `Peer not found: ${workerId}`,
        code: ErrorCodes.PEER_NOT_FOUND,
      });
      return;
    }

    state.peers.delete(workerId);

    // Also remove from any work groups
    for (const [, group] of state.workGroups) {
      group.members = group.members.filter(m => m.workerId !== workerId);
    }

    res.status(200).json({ success: true });
  });

  return router;
}

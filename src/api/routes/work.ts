import { Router, Request, Response } from 'express';
import {
  ApiState,
  isInRoster,
  getAssignmentsForAccount,
  isBlockAssignedTo,
  buildIdempotencyKey,
} from '../state';
import {
  WorkRequestRequest,
  WorkRequestResponse,
  WorkSubmitRequest,
  WorkSubmitResponse,
  SubmissionResultItem,
  ErrorCodes,
} from '../types';
import { DEFAULT_REWARD_CONFIG } from '../../types';
import { BlockSubmission } from '../../services/serviceTypes';
import { processSubmission } from '../../services/submissionService';
import { verify } from '../../crypto/signing';

/** Convert hex string to Uint8Array */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Validate nodeKey for a given accountId (legacy auth path)
 */
function validateNodeKey(
  state: ApiState,
  accountId: string,
  nodeKey: string,
  res: Response
): boolean {
  // Check if node exists
  if (!state.networkState.contributors.has(accountId)) {
    res.status(404).json({
      success: false,
      error: `Node not found: ${accountId}`,
      code: ErrorCodes.NODE_NOT_FOUND,
    });
    return false;
  }

  // Validate nodeKey
  const storedKey = state.nodeKeys.get(accountId);
  if (storedKey !== nodeKey) {
    res.status(401).json({
      success: false,
      error: 'Invalid nodeKey',
      code: ErrorCodes.INVALID_NODE_KEY,
    });
    return false;
  }

  return true;
}

/**
 * Validate device signature auth.
 * Body must include deviceId + deviceSignature (hex).
 * The signature is over "AI4A:WORK:v1" + accountId + dayId.
 * Returns the resolved accountId or null (response already sent).
 */
async function validateDeviceAuth(
  state: ApiState,
  deviceId: string,
  deviceSignature: string,
  accountId: string,
  res: Response
): Promise<boolean> {
  const device = state.devices.get(deviceId);
  if (!device) {
    res.status(404).json({
      success: false,
      error: 'Device not found',
      code: ErrorCodes.DEVICE_NOT_FOUND,
    });
    return false;
  }

  // Device must be linked to the claimed accountId
  if (device.accountId !== accountId) {
    res.status(403).json({
      success: false,
      error: 'Device not linked to this account',
      code: ErrorCodes.DEVICE_SIGNATURE_INVALID,
    });
    return false;
  }

  // Verify device signature
  const payload = `AI4A:WORK:v1${accountId}${state.currentDayId ?? ''}`;
  const payloadBytes = new TextEncoder().encode(payload);
  try {
    const sigBytes = hexToBytes(deviceSignature);
    const pkBytes = hexToBytes(device.devicePublicKey);
    const valid = await verify(payloadBytes, sigBytes, pkBytes);
    if (!valid) {
      res.status(401).json({
        success: false,
        error: 'Device signature verification failed',
        code: ErrorCodes.DEVICE_SIGNATURE_INVALID,
      });
      return false;
    }
  } catch {
    res.status(401).json({
      success: false,
      error: 'Device signature verification error',
      code: ErrorCodes.DEVICE_SIGNATURE_INVALID,
    });
    return false;
  }

  return true;
}

/**
 * Create router for work endpoints
 */
export function createWorkRouter(state: ApiState): Router {
  const router = Router();

  /**
   * POST /work/request
   * Request work assignments for current day
   */
  router.post('/request', async (req: Request, res: Response) => {
    const body = req.body as WorkRequestRequest & { deviceId?: string; deviceSignature?: string };

    // Validate required fields
    if (!body.accountId || typeof body.accountId !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Missing accountId',
        code: ErrorCodes.MISSING_ACCOUNT_ID,
      });
      return;
    }

    const accountId = body.accountId.trim();

    // Dual auth: device signature takes priority, falls back to nodeKey
    if (body.deviceId && body.deviceSignature) {
      const ok = await validateDeviceAuth(state, body.deviceId, body.deviceSignature, accountId, res);
      if (!ok) return;
    } else if (body.nodeKey && typeof body.nodeKey === 'string') {
      if (!validateNodeKey(state, accountId, body.nodeKey, res)) return;
    } else {
      res.status(401).json({
        success: false,
        error: 'Missing authentication: provide nodeKey or deviceId+deviceSignature',
        code: ErrorCodes.INVALID_NODE_KEY,
      });
      return;
    }

    // Check if day is active
    if (state.dayPhase !== 'ACTIVE') {
      res.status(409).json({
        success: false,
        error: state.dayPhase === 'FINALIZING' ? 'Day is finalizing' : 'No day started',
        code: state.dayPhase === 'FINALIZING' ? ErrorCodes.DAY_FINALIZING : ErrorCodes.DAY_NOT_STARTED,
      });
      return;
    }

    // Check if node is in roster (registered before day start)
    if (!isInRoster(state, accountId)) {
      const response: WorkRequestResponse = {
        success: true,
        dayId: state.currentDayId!,
        assignments: [],
        reason: 'ROSTER_LOCKED',
      };
      res.status(200).json(response);
      return;
    }

    // Get assignments for this node
    const assignments = getAssignmentsForAccount(state, accountId);

    const response: WorkRequestResponse = {
      success: true,
      dayId: state.currentDayId!,
      assignments,
      reason: assignments.length === 0 ? 'NO_ASSIGNMENTS' : undefined,
    };

    res.status(200).json(response);
  });

  /**
   * POST /work/submit
   * Submit completed work
   */
  router.post('/submit', async (req: Request, res: Response) => {
    const body = req.body as WorkSubmitRequest & { deviceId?: string; deviceSignature?: string };

    // Validate required fields
    if (!body.accountId || typeof body.accountId !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Missing accountId',
        code: ErrorCodes.MISSING_ACCOUNT_ID,
      });
      return;
    }

    if (!body.submissions || !Array.isArray(body.submissions)) {
      res.status(400).json({
        success: false,
        error: 'Missing or invalid submissions array',
        code: ErrorCodes.INTERNAL_ERROR,
      });
      return;
    }

    const accountId = body.accountId.trim();

    // Dual auth: device signature takes priority, falls back to nodeKey
    if (body.deviceId && body.deviceSignature) {
      const ok = await validateDeviceAuth(state, body.deviceId, body.deviceSignature, accountId, res);
      if (!ok) return;
    } else if (body.nodeKey && typeof body.nodeKey === 'string') {
      if (!validateNodeKey(state, accountId, body.nodeKey, res)) return;
    } else {
      res.status(401).json({
        success: false,
        error: 'Missing authentication: provide nodeKey or deviceId+deviceSignature',
        code: ErrorCodes.INVALID_NODE_KEY,
      });
      return;
    }

    // Check if day is active
    if (state.dayPhase !== 'ACTIVE') {
      res.status(409).json({
        success: false,
        error: state.dayPhase === 'FINALIZING' ? 'Day is finalizing' : 'No day started',
        code: state.dayPhase === 'FINALIZING' ? ErrorCodes.DAY_FINALIZING : ErrorCodes.DAY_NOT_STARTED,
      });
      return;
    }

    // Check dayId if provided
    if (body.dayId && body.dayId !== state.currentDayId) {
      res.status(409).json({
        success: false,
        error: `Day mismatch: expected ${state.currentDayId}, got ${body.dayId}`,
        code: ErrorCodes.DAY_MISMATCH,
      });
      return;
    }

    const currentDayId = state.currentDayId!;
    const results: SubmissionResultItem[] = [];

    for (const sub of body.submissions) {
      const idempotencyKey = buildIdempotencyKey(accountId, sub.blockId, currentDayId);

      // Check for cached result (idempotency)
      const cached = state.processedSubmissions.get(idempotencyKey);
      if (cached) {
        results.push(cached);
        continue;
      }

      // Check assignment ownership
      if (!isBlockAssignedTo(state, accountId, sub.blockId)) {
        const notAssignedResult: SubmissionResultItem = {
          blockId: sub.blockId,
          accepted: false,
          error: 'Block not assigned to this node',
        };
        state.processedSubmissions.set(idempotencyKey, notAssignedResult);
        results.push(notAssignedResult);
        continue;
      }

      // Get contributor
      const contributor = state.networkState.contributors.get(accountId)!;

      // Check if this is a canary block
      const isCanary = state.currentCanaryBlockIds.has(sub.blockId);

      // Build submission
      const submission: BlockSubmission = {
        contributorId: accountId,
        blockId: sub.blockId,
        blockType: sub.blockType,
        resourceUsage: sub.resourceUsage,
        difficultyMultiplier: sub.difficultyMultiplier,
        validationPassed: sub.validationPassed,
        canaryAnswerCorrect: sub.canaryAnswerCorrect,
        timestamp: new Date(),
      };

      // Process submission
      const { contributor: updatedContributor, result } = processSubmission(
        contributor,
        submission,
        isCanary,
        DEFAULT_REWARD_CONFIG
      );

      // Update contributor in state
      const newContributors = new Map(state.networkState.contributors);
      newContributors.set(accountId, updatedContributor);
      state.networkState = {
        ...state.networkState,
        contributors: newContributors,
      };

      // Add to pending submissions for finalization
      state.pendingSubmissions.push(submission);

      // Build result item
      const resultItem: SubmissionResultItem = {
        blockId: sub.blockId,
        accepted: true,
        canaryDetected: result.canaryDetected,
        canaryPassed: result.canaryPassed,
        penaltyApplied: result.penaltyApplied,
      };

      // Cache result for idempotency
      state.processedSubmissions.set(idempotencyKey, resultItem);
      results.push(resultItem);
    }

    const response: WorkSubmitResponse = {
      success: true,
      results,
    };

    res.status(200).json(response);
  });

  return router;
}

import { Router, Request, Response } from 'express';
import { requireAdminKey } from '../middleware/adminAuth';
import { ApiState } from '../state';
import {
  DayStartRequest,
  DayStartResponse,
  DayStatusResponse,
  FinalizeResponse,
  ErrorCodes,
} from '../types';
import { startNewDay, finalizeCurrent } from '../../services/dayLifecycleService';

/**
 * Create router for admin endpoints
 */
export function createAdminRouter(state: ApiState): Router {
  const router = Router();

  // All admin routes require X-Admin-Key
  router.use(requireAdminKey);

  /**
   * POST /admin/day/start
   * Start a new day: lock roster, compute seed, generate assignments
   */
  router.post('/day/start', (req: Request, res: Response) => {
    const body = req.body as DayStartRequest;

    // Check if day is already active
    if (state.dayPhase !== 'IDLE') {
      res.status(409).json({
        success: false,
        error: `Day already ${state.dayPhase.toLowerCase()}: ${state.currentDayId}`,
        code: ErrorCodes.DAY_ALREADY_ACTIVE,
      });
      return;
    }

    const result = startNewDay(state, body.dayId);

    const response: DayStartResponse = {
      success: true,
      dayId: result.dayId,
      activeContributors: result.activeContributors,
      totalBlocks: result.totalBlocks,
      seed: result.seed,
      rosterHash: result.rosterHash,
    };

    res.status(200).json(response);
  });

  /**
   * GET /admin/day/status
   * Get current day state for debugging
   */
  router.get('/day/status', (_req: Request, res: Response) => {
    const response: DayStatusResponse = {
      success: true,
      dayPhase: state.dayPhase,
      dayId: state.currentDayId,
      rosterSize: state.currentRosterAccountIds.length,
      pendingSubmissionCount: state.pendingSubmissions.length,
    };

    res.status(200).json(response);
  });

  /**
   * POST /admin/day/finalize
   * Finalize the day: process all submissions, distribute rewards, persist
   */
  router.post('/day/finalize', async (_req: Request, res: Response) => {
    // Check if day is active
    if (state.dayPhase !== 'ACTIVE') {
      res.status(409).json({
        success: false,
        error: state.dayPhase === 'IDLE' ? 'No day started' : 'Day already finalizing',
        code: state.dayPhase === 'IDLE' ? ErrorCodes.DAY_NOT_STARTED : ErrorCodes.DAY_FINALIZING,
      });
      return;
    }

    try {
      const result = await finalizeCurrent(state);

      const response: FinalizeResponse = {
        success: true,
        dayId: result.dayId,
        verification: result.verification,
        summary: result.summary,
      };

      res.status(200).json(response);
    } catch (error) {
      // Reset to ACTIVE on error so admin can retry
      state.dayPhase = 'ACTIVE';

      console.error('Finalization error:', error);
      res.status(500).json({
        success: false,
        error: 'Finalization failed',
        code: ErrorCodes.INTERNAL_ERROR,
      });
    }
  });

  return router;
}

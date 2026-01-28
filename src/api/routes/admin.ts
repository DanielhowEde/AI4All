import { Router, Request, Response } from 'express';
import { requireAdminKey } from '../middleware/adminAuth';
import { ApiState, computeRosterHash, computeDaySeed, formatDayId, resetDayState } from '../state';
import {
  DayStartRequest,
  DayStartResponse,
  DayStatusResponse,
  FinalizeResponse,
  ErrorCodes,
} from '../types';
import { DEFAULT_REWARD_CONFIG, DEFAULT_BLOCK_ASSIGNMENT_CONFIG } from '../../types';
import { DEFAULT_CANARY_CONFIG, seededRandom } from '../../canaryGenerator';
import { assignDailyWork } from '../../services/workAssignmentService';
import { persistDay } from '../../persistence/persistDay';

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

    // Determine dayId (default to today UTC)
    const dayId = body.dayId || formatDayId(new Date());

    // Lock roster: get sorted list of all registered contributors
    const accountIds = Array.from(state.networkState.contributors.keys()).sort();
    state.currentRosterAccountIds = accountIds;

    // Compute deterministic seed from dayId + roster
    const rosterHash = computeRosterHash(accountIds);
    const seed = computeDaySeed(dayId, rosterHash);
    state.currentDaySeed = seed;

    // Get all registered contributors for assignment
    // Per plan: "Active = registered contributors (no liveness check for now)"
    const allContributors = Array.from(state.networkState.contributors.values());

    // Generate assignments using seeded random
    const random = seededRandom(seed);
    const { assignments, canaryBlockIds } = assignDailyWork(
      allContributors,
      DEFAULT_BLOCK_ASSIGNMENT_CONFIG,
      DEFAULT_CANARY_CONFIG,
      new Date(),
      random
    );

    // Store in state
    state.currentDayAssignments = assignments;
    state.currentCanaryBlockIds = canaryBlockIds;
    state.currentDayId = dayId;
    state.dayPhase = 'ACTIVE';

    // Count total blocks
    const totalBlocks = assignments.reduce((sum, a) => sum + a.blockIds.length, 0);

    const response: DayStartResponse = {
      success: true,
      dayId,
      activeContributors: allContributors.length,
      totalBlocks,
      seed,
      rosterHash,
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

    // Set to FINALIZING to reject new submissions
    state.dayPhase = 'FINALIZING';

    try {
      const dayId = state.currentDayId!;
      // Use the dayId to create a timestamp at noon UTC for that day
      // This ensures events are stored with the correct dayId
      const currentTime = new Date(`${dayId}T12:00:00Z`);

      // Build day config with the same seed for determinism
      const config = {
        rewardConfig: DEFAULT_REWARD_CONFIG,
        blockAssignmentConfig: DEFAULT_BLOCK_ASSIGNMENT_CONFIG,
        canaryConfig: DEFAULT_CANARY_CONFIG,
        currentTime,
        random: state.currentDaySeed !== null ? seededRandom(state.currentDaySeed) : undefined,
      };

      // Persist day (runs simulation + persists to stores)
      const { newState, result } = await persistDay(
        state.networkState,
        state.pendingSubmissions,
        config,
        state.stores
      );

      // Update network state
      state.networkState = newState;

      // Reset day state
      resetDayState(state);

      const response: FinalizeResponse = {
        success: true,
        dayId,
        verification: result.verification,
        summary: {
          activeContributors: result.rewardDistribution.activeContributorCount,
          totalEmissions: result.rewardDistribution.totalEmissions,
          basePoolTotal: result.rewardDistribution.basePoolTotal,
          performancePoolTotal: result.rewardDistribution.performancePoolTotal,
        },
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

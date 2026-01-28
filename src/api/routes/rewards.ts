import { Router, Request, Response } from 'express';
import { ApiState } from '../state';
import { RewardsResponse, ErrorCodes } from '../types';
import {
  buildRewardCommitment,
  rewardsToEntries,
  serializeRewardProof,
  computeRewardRoot,
} from '../../merkle';

/**
 * Create router for rewards endpoints
 */
export function createRewardsRouter(state: ApiState): Router {
  const router = Router();

  /**
   * GET /rewards/day
   * Query reward distribution for a day
   * Query params: dayId (optional, defaults to latest finalized day)
   */
  router.get('/day', async (req: Request, res: Response) => {
    const queryDayId = req.query.dayId as string | undefined;

    try {
      let dayId: string;
      let events;

      if (queryDayId) {
        // Query specific day
        dayId = queryDayId;
        events = await state.stores.event.queryByDay(dayId);
      } else {
        // Find latest day with DAY_FINALIZED event
        // Query all DAY_FINALIZED events and find the latest by dayId (lexicographic)
        const finalizedEvents = await state.stores.event.queryByType('DAY_FINALIZED');

        if (finalizedEvents.length === 0) {
          res.status(404).json({
            success: false,
            error: 'No reward distributions found',
            code: ErrorCodes.NO_DISTRIBUTION_FOUND,
          });
          return;
        }

        // Sort by dayId descending (lexicographic) to get latest
        finalizedEvents.sort((a, b) => b.dayId.localeCompare(a.dayId));
        dayId = finalizedEvents[0].dayId;
        events = await state.stores.event.queryByDay(dayId);
      }

      // Find DAY_FINALIZED event for this day
      const dayFinalizedEvent = events.find(e => e.eventType === 'DAY_FINALIZED');

      if (!dayFinalizedEvent) {
        res.status(404).json({
          success: false,
          error: `No reward distribution found for day: ${dayId}`,
          code: ErrorCodes.NO_DISTRIBUTION_FOUND,
        });
        return;
      }

      // Extract reward data from event payload
      const payload = dayFinalizedEvent.payload as {
        rewards: Array<{
          accountId: string;
          totalReward: number;
          basePoolReward: number;
          performancePoolReward: number;
        }>;
        totalEmissions: number;
        activeCount: number;
      };

      const response: RewardsResponse = {
        success: true,
        dayId,
        distribution: {
          totalEmissions: payload.totalEmissions,
          activeContributorCount: payload.activeCount,
          rewards: payload.rewards,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      console.error('Error querying rewards:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to query rewards',
        code: ErrorCodes.INTERNAL_ERROR,
      });
    }
  });

  /**
   * GET /rewards/proof
   * Get Merkle proof for a specific account's reward
   * Query params: dayId (required), accountId (required)
   */
  router.get('/proof', async (req: Request, res: Response) => {
    const dayId = req.query.dayId as string | undefined;
    const accountId = req.query.accountId as string | undefined;

    if (!dayId) {
      res.status(400).json({
        success: false,
        error: 'Missing required parameter: dayId',
        code: ErrorCodes.INTERNAL_ERROR,
      });
      return;
    }

    if (!accountId) {
      res.status(400).json({
        success: false,
        error: 'Missing required parameter: accountId',
        code: ErrorCodes.INTERNAL_ERROR,
      });
      return;
    }

    try {
      // Load events for the day
      const events = await state.stores.event.queryByDay(dayId);
      const dayFinalizedEvent = events.find(e => e.eventType === 'DAY_FINALIZED');

      if (!dayFinalizedEvent) {
        res.status(404).json({
          success: false,
          error: `No reward distribution found for day: ${dayId}`,
          code: ErrorCodes.NO_DISTRIBUTION_FOUND,
        });
        return;
      }

      // Extract rewards from event
      const payload = dayFinalizedEvent.payload as {
        rewards: Array<{
          accountId: string;
          totalReward: number;
          basePoolReward: number;
          performancePoolReward: number;
        }>;
      };

      // Convert to reward entries and build commitment
      const entries = rewardsToEntries(payload.rewards);
      const commitment = buildRewardCommitment(dayId, entries);

      // Get proof for account
      const proof = commitment.getProof(accountId);

      if (!proof) {
        res.status(404).json({
          success: false,
          error: `No reward found for account ${accountId} on day ${dayId}`,
          code: ErrorCodes.NO_DISTRIBUTION_FOUND,
        });
        return;
      }

      // Serialize proof for JSON response
      const serializedProof = serializeRewardProof(proof);

      res.status(200).json({
        success: true,
        dayId,
        accountId,
        rewardRoot: commitment.root,
        leafCount: commitment.leafCount,
        proof: serializedProof,
      });
    } catch (error) {
      console.error('Error generating proof:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate proof',
        code: ErrorCodes.INTERNAL_ERROR,
      });
    }
  });

  /**
   * GET /rewards/root
   * Get Merkle root for a day's reward distribution
   * Query params: dayId (required)
   */
  router.get('/root', async (req: Request, res: Response) => {
    const dayId = req.query.dayId as string | undefined;

    if (!dayId) {
      res.status(400).json({
        success: false,
        error: 'Missing required parameter: dayId',
        code: ErrorCodes.INTERNAL_ERROR,
      });
      return;
    }

    try {
      // Load events for the day
      const events = await state.stores.event.queryByDay(dayId);
      const dayFinalizedEvent = events.find(e => e.eventType === 'DAY_FINALIZED');

      if (!dayFinalizedEvent) {
        res.status(404).json({
          success: false,
          error: `No reward distribution found for day: ${dayId}`,
          code: ErrorCodes.NO_DISTRIBUTION_FOUND,
        });
        return;
      }

      // Extract rewards from event
      const payload = dayFinalizedEvent.payload as {
        rewards: Array<{ accountId: string; totalReward: number }>;
        totalEmissions: number;
        activeCount: number;
      };

      // Convert and compute root
      const entries = rewardsToEntries(payload.rewards);
      const root = computeRewardRoot(dayId, entries);

      res.status(200).json({
        success: true,
        dayId,
        rewardRoot: root,
        leafCount: entries.length,
        totalEmissions: payload.totalEmissions,
        activeContributorCount: payload.activeCount,
      });
    } catch (error) {
      console.error('Error computing root:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to compute reward root',
        code: ErrorCodes.INTERNAL_ERROR,
      });
    }
  });

  return router;
}

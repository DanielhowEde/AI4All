import { Router, Request, Response } from 'express';
import { ApiState } from '../state';
import { ErrorCodes } from '../types';
import { MICRO_UNITS } from '../../fixedPoint';

/** Convert bigint microunits to token number for JSON responses */
function toTokenDisplay(micro: bigint): number {
  return Number(micro) / Number(MICRO_UNITS);
}

/** Clamp a query-string limit to [1, max] with a fallback default */
function parseLimit(raw: string | undefined, defaultVal: number, max: number): number {
  const parsed = parseInt(raw as string, 10);
  if (Number.isNaN(parsed) || parsed < 1) return defaultVal;
  return Math.min(parsed, max);
}

/** Validate accountId format: 1-64 chars, no control characters */
function isValidAccountId(id: string): boolean {
  return id.length >= 1 && id.length <= 64 && !/[\x00-\x1f]/.test(id);
}

/**
 * Create router for account/balance endpoints
 */
export function createAccountsRouter(state: ApiState): Router {
  const router = Router();

  /**
   * GET /accounts/leaderboard
   * Top earners (placed before param routes to avoid /:accountId conflict)
   */
  router.get('/leaderboard', (req: Request, res: Response) => {
    const limit = parseLimit(req.query.limit as string, 20, 100);

    if (!state.balanceStore) {
      res.status(200).json({
        success: true,
        leaderboard: [],
        note: 'Balance tracking requires SQLite backend',
      });
      return;
    }

    const rows = state.balanceStore.getLeaderboard(limit);

    res.status(200).json({
      success: true,
      leaderboard: rows.map((r, rank) => ({
        rank: rank + 1,
        accountId: r.accountId,
        balance: toTokenDisplay(r.balanceMicro),
        totalEarned: toTokenDisplay(r.totalEarnedMicro),
        lastRewardDay: r.lastRewardDay,
      })),
    });
  });

  /**
   * GET /accounts/supply
   * Total circulating supply
   */
  router.get('/supply', (_req: Request, res: Response) => {
    if (!state.balanceStore) {
      res.status(200).json({
        success: true,
        totalSupply: 0,
        totalSupplyMicro: '0',
        note: 'Balance tracking requires SQLite backend',
      });
      return;
    }

    const supplyMicro = state.balanceStore.getTotalSupply();

    res.status(200).json({
      success: true,
      totalSupply: toTokenDisplay(supplyMicro),
      totalSupplyMicro: supplyMicro.toString(),
      dailyEmissions: 22_000,
      contributorCount: state.networkState.contributors.size,
    });
  });

  /**
   * GET /accounts/:accountId/balance
   * Returns current balance for an account
   */
  router.get('/:accountId/balance', (req: Request, res: Response) => {
    const accountId = req.params.accountId as string;

    if (!isValidAccountId(accountId)) {
      res.status(400).json({
        success: false,
        error: 'Invalid accountId',
        code: ErrorCodes.MISSING_ACCOUNT_ID,
      });
      return;
    }

    if (!state.networkState.contributors.has(accountId)) {
      res.status(404).json({
        success: false,
        error: `Account not found: ${accountId}`,
        code: ErrorCodes.NODE_NOT_FOUND,
      });
      return;
    }

    if (!state.balanceStore) {
      res.status(200).json({
        success: true,
        accountId,
        balance: 0,
        totalEarned: 0,
        lastRewardDay: null,
        note: 'Balance tracking requires SQLite backend',
      });
      return;
    }

    const row = state.balanceStore.getBalance(accountId);

    res.status(200).json({
      success: true,
      accountId,
      balance: row ? toTokenDisplay(row.balanceMicro) : 0,
      balanceMicro: row ? row.balanceMicro.toString() : '0',
      totalEarned: row ? toTokenDisplay(row.totalEarnedMicro) : 0,
      totalEarnedMicro: row ? row.totalEarnedMicro.toString() : '0',
      lastRewardDay: row?.lastRewardDay ?? null,
    });
  });

  /**
   * GET /accounts/:accountId/history
   * Returns reward history for an account
   */
  router.get('/:accountId/history', (req: Request, res: Response) => {
    const accountId = req.params.accountId as string;

    if (!isValidAccountId(accountId)) {
      res.status(400).json({
        success: false,
        error: 'Invalid accountId',
        code: ErrorCodes.MISSING_ACCOUNT_ID,
      });
      return;
    }

    const limit = parseLimit(req.query.limit as string, 30, 100);

    if (!state.balanceStore) {
      res.status(200).json({
        success: true,
        accountId,
        history: [],
        note: 'Balance tracking requires SQLite backend',
      });
      return;
    }

    const rows = state.balanceStore.getHistory(accountId, limit);

    res.status(200).json({
      success: true,
      accountId,
      history: rows.map(r => ({
        dayId: r.dayId,
        amount: toTokenDisplay(r.amountMicro),
        amountMicro: r.amountMicro.toString(),
        balanceAfter: toTokenDisplay(r.balanceAfterMicro),
        type: r.entryType,
        timestamp: r.timestamp,
      })),
    });
  });

  return router;
}

import { Router, Request, Response } from 'express';
import { ApiState } from '../state';
import { verifyWorkerAuth } from '../auth';
import type { DataIngestRequest } from '../types';

export function createDataRouter(state: ApiState): Router {
  const router = Router();

  /**
   * POST /data/crawled
   * Worker submits crawled pages. Auth: ML-DSA-65 signature.
   * Deduplicates by contentHash and credits flat reward per new page.
   */
  router.post('/crawled', async (req: Request, res: Response) => {
    const { accountId, timestamp, signature, pages } = req.body as DataIngestRequest;

    if (!accountId || !Array.isArray(pages)) {
      res.status(400).json({ success: false, error: 'Missing accountId or pages' });
      return;
    }

    const ok = await verifyWorkerAuth(state.publicKeys, accountId, timestamp, signature, res);
    if (!ok) return;

    // Deduplicate by contentHash
    const existingHashes = new Set(state.crawledData.map(p => p.contentHash));
    const newPages = pages.filter(p => p.contentHash && !existingHashes.has(p.contentHash));
    for (const page of newPages) {
      state.crawledData.push({ ...page, workerAccountId: accountId });
    }

    // Flat reward: 1000 nanounits per accepted page
    const rewardNano = BigInt(newPages.length) * 1000n;
    if (newPages.length > 0 && state.balanceLedger && state.dayPhase === 'ACTIVE' && state.currentDayId) {
      state.balanceLedger.creditRewards(state.currentDayId, [{
        accountId,
        amountMicro: rewardNano,
      }]);
    }

    res.json({
      success: true,
      accepted: newPages.length,
      reward: rewardNano.toString(),
    });
  });

  /**
   * GET /data/crawled
   * Return recent crawled pages. Optional ?url= prefix filter.
   */
  router.get('/crawled', (req: Request, res: Response) => {
    const urlFilter = typeof req.query.url === 'string'
      ? req.query.url.toLowerCase()
      : null;

    let pages = [...state.crawledData].reverse(); // Newest first

    if (urlFilter) {
      pages = pages.filter(p => p.url.toLowerCase().startsWith(urlFilter));
    }

    pages = pages.slice(0, 100); // Cap at 100
    res.json({ success: true, pages });
  });

  return router;
}

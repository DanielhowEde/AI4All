import express, { Express, Request, Response, NextFunction } from 'express';
import { ApiState } from './state';
import { createNodesRouter } from './routes/nodes';
import { createAdminRouter } from './routes/admin';
import { createWorkRouter } from './routes/work';
import { createRewardsRouter } from './routes/rewards';
import { createPairingRouter } from './routes/pairing';
import { createAccountsRouter } from './routes/accounts';
import { createGovernanceRouter } from './routes/governance';
import { ErrorCodes } from './types';

/**
 * Create an Express app with all routes configured
 */
export function createApp(state: ApiState): Express {
  const app = express();

  // Parse JSON bodies (10MB limit for large batch submissions)
  app.use(express.json({ limit: '10mb' }));

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      dayPhase: state.dayPhase,
      currentDayId: state.currentDayId,
      contributors: state.networkState.contributors.size,
      dayNumber: state.networkState.dayNumber,
      pendingSubmissions: state.pendingSubmissions.length,
    });
  });

  // Mount routes
  app.use('/nodes', createNodesRouter(state));
  app.use('/admin', createAdminRouter(state));
  app.use('/work', createWorkRouter(state));
  app.use('/rewards', createRewardsRouter(state));
  app.use('/pairing', createPairingRouter(state));
  app.use('/accounts', createAccountsRouter(state));
  app.use('/governance', createGovernanceRouter(state));

  // Global error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: ErrorCodes.INTERNAL_ERROR,
    });
  });

  return app;
}

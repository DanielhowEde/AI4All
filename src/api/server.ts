import { createApp } from './app';
import { createApiState, ApiState } from './state';
import { createInMemoryStores } from '../persistence/inMemoryStores';
import { createSqliteStores } from '../persistence/sqlite';
import { restoreApiState } from './restore';
import { DayScheduler } from './scheduler';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const USE_SQLITE = process.env.STORE_BACKEND !== 'memory';

async function main() {
  let state: ApiState;
  let closeFn: (() => void) | undefined;

  if (USE_SQLITE) {
    const dbPath = process.env.DB_PATH;
    const sqliteStores = createSqliteStores(dbPath);
    closeFn = () => sqliteStores.db.close();

    state = await restoreApiState(sqliteStores);
    console.log(
      `State restored: day ${state.networkState.dayNumber}, phase ${state.dayPhase}, ` +
      `${state.networkState.contributors.size} contributors, ${state.nodeKeys.size} nodeKeys`
    );
  } else {
    const stores = createInMemoryStores();
    state = createApiState(stores);
    console.log('Using in-memory stores (data will not persist)');
  }

  const app = createApp(state);

  // Initialize scheduler if configured
  let scheduler: DayScheduler | undefined;
  if (process.env.SCHEDULER_ENABLED === 'true') {
    scheduler = new DayScheduler(state, {
      startCron: process.env.SCHEDULER_START_CRON || '0 0 * * *',
      finalizeCron: process.env.SCHEDULER_FINALIZE_CRON || '55 23 * * *',
      timezone: process.env.SCHEDULER_TIMEZONE || 'UTC',
    });
    scheduler.start();
  }

  const server = app.listen(PORT, () => {
    console.log(`AI4All API server running on port ${PORT}`);
    console.log(`Store backend: ${USE_SQLITE ? 'SQLite' : 'in-memory'}`);
    console.log(`Admin key: ${process.env.ADMIN_KEY ? '[SET]' : 'test-admin-key (default)'}`);
    if (scheduler) console.log('Day scheduler: enabled');
    console.log(`Health check: http://localhost:${PORT}/health`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('Shutting down...');
    scheduler?.stop();
    server.close(() => {
      closeFn?.();
      console.log('Server stopped.');
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('Startup failed:', err);
  process.exit(1);
});

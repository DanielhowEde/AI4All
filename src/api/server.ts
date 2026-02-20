import { createApp } from './app';
import { createApiState, ApiState } from './state';
import { createInMemoryStores } from '../persistence/inMemoryStores';
import { createFileStores } from '../persistence/file';
import { restoreApiState } from './restore';
import { DayScheduler } from './scheduler';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const USE_PERSISTENT = process.env.STORE_BACKEND !== 'memory';

// Peers that haven't heartbeated within this window are pruned from the directory.
// Default 5 minutes. Override with PEER_STALE_TTL_SECS env var.
const PEER_STALE_TTL_MS =
  (process.env.PEER_STALE_TTL_SECS ? parseInt(process.env.PEER_STALE_TTL_SECS, 10) : 300) * 1000;

async function main() {
  let state: ApiState;

  if (USE_PERSISTENT) {
    const dataDir = process.env.DATA_DIR;
    const fileStores = await createFileStores(dataDir);

    state = await restoreApiState(fileStores);
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

  // Prune peers that haven't heartbeated recently (every 60 seconds)
  const peerPruner = setInterval(() => {
    const cutoff = new Date(Date.now() - PEER_STALE_TTL_MS).toISOString();
    const stale: string[] = [];
    for (const [workerId, peer] of state.peers) {
      if (peer.lastSeen < cutoff) stale.push(workerId);
    }
    for (const workerId of stale) {
      state.peers.delete(workerId);
      // Remove from work groups too
      for (const [, group] of state.workGroups) {
        group.members = group.members.filter(m => m.workerId !== workerId);
      }
    }
    if (stale.length > 0) {
      console.log(`Pruned ${stale.length} stale peer(s): ${stale.join(', ')}`);
    }
  }, 60_000);

  const server = app.listen(PORT, () => {
    console.log(`AI4All API server running on port ${PORT}`);
    console.log(`Store backend: ${USE_PERSISTENT ? 'file' : 'in-memory'}`);
    console.log(`Admin key: ${process.env.ADMIN_KEY ? '[SET]' : 'test-admin-key (default)'}`);
    if (scheduler) console.log('Day scheduler: enabled');
    console.log(`Peer stale TTL: ${PEER_STALE_TTL_MS / 1000}s (prune interval: 60s)`);
    console.log(`Health check: http://localhost:${PORT}/health`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('Shutting down...');
    clearInterval(peerPruner);
    scheduler?.stop();
    server.close(() => {
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

import { createApp } from './app';
import { createApiState } from './state';
import { createInMemoryStores } from '../persistence/inMemoryStores';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Create stores (in-memory for now)
const stores = createInMemoryStores();

// Create API state
const state = createApiState(stores);

// Create Express app
const app = createApp(state);

// Start server
app.listen(PORT, () => {
  console.log(`AI4All API server running on port ${PORT}`);
  console.log(`Admin key: ${process.env.ADMIN_KEY ? '[SET]' : 'test-admin-key (default)'}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

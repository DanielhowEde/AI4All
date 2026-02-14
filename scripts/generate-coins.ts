#!/usr/bin/env ts-node
/**
 * AI4All Coin Generation Demo
 *
 * Runs the full E2E flow against a running server:
 *   1. Register nodes
 *   2. Start a day
 *   3. Request work assignments
 *   4. Submit completed work
 *   5. Finalize the day → tokens are minted
 *   6. Check balances
 *
 * Usage:
 *   npm run generate-coins
 *   # or:
 *   npx ts-node scripts/generate-coins.ts [--days 3] [--nodes 5] [--port 3000]
 */

const BASE_URL = `http://localhost:${process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : '3000'}`;
const ADMIN_KEY = process.env.ADMIN_KEY || 'test-admin-key';

const NODE_COUNT = parseInt(
  process.argv.includes('--nodes') ? process.argv[process.argv.indexOf('--nodes') + 1] : '3',
  10
);
const DAY_COUNT = parseInt(
  process.argv.includes('--days') ? process.argv[process.argv.indexOf('--days') + 1] : '1',
  10
);

interface NodeInfo {
  accountId: string;
  nodeKey: string;
}

async function api(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok && !(json as { success?: boolean }).success) {
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json)}`);
  }
  return json as Record<string, unknown>;
}

async function adminApi(method: string, path: string, body?: unknown) {
  return api(method, path, body, { 'X-Admin-Key': ADMIN_KEY });
}

// ─── Step 1: Register nodes ─────────────────────────────────────
async function registerNodes(count: number): Promise<NodeInfo[]> {
  console.log(`\n=== Registering ${count} nodes ===`);
  const nodes: NodeInfo[] = [];

  for (let i = 1; i <= count; i++) {
    const accountId = `node-${i}`;
    try {
      const res = await api('POST', '/nodes/register', { accountId });
      const nodeKey = res.nodeKey as string;
      nodes.push({ accountId, nodeKey });
      console.log(`  [+] ${accountId} → nodeKey=${nodeKey.substring(0, 8)}...`);
    } catch (err: unknown) {
      // Already registered — try heartbeat to validate existing key
      const msg = (err as Error).message;
      if (msg.includes('409')) {
        console.log(`  [=] ${accountId} already registered (skipped)`);
        // We don't know the nodeKey for existing nodes; skip
      } else {
        throw err;
      }
    }
  }
  return nodes;
}

// ─── Step 2: Start a day ────────────────────────────────────────
async function startDay(dayId?: string): Promise<{ dayId: string; totalBlocks: number }> {
  console.log(`\n=== Starting day ${dayId ?? '(auto)'} ===`);
  const res = await adminApi('POST', '/admin/day/start', dayId ? { dayId } : {});
  console.log(`  Day ID:              ${res.dayId}`);
  console.log(`  Active contributors: ${res.activeContributors}`);
  console.log(`  Total blocks:        ${res.totalBlocks}`);
  return { dayId: res.dayId as string, totalBlocks: res.totalBlocks as number };
}

// ─── Step 3: Request work ───────────────────────────────────────
interface Assignment {
  blockId: string;
  batchNumber: number;
}

async function requestWork(
  node: NodeInfo,
): Promise<Assignment[]> {
  const res = await api('POST', '/work/request', {
    accountId: node.accountId,
    nodeKey: node.nodeKey,
  });
  const assignments = (res.assignments ?? []) as Assignment[];
  console.log(`  ${node.accountId}: ${assignments.length} blocks assigned`);
  return assignments;
}

// ─── Step 4: Submit work (batched) ──────────────────────────────
const BATCH_SIZE = 200; // Submit in chunks to avoid body-size / memory issues

async function submitWork(
  node: NodeInfo,
  assignments: Assignment[],
): Promise<number> {
  if (assignments.length === 0) return 0;

  const blockTypes = ['INFERENCE', 'EMBEDDINGS', 'VALIDATION', 'TRAINING'];
  let totalAccepted = 0;
  const batches = Math.ceil(assignments.length / BATCH_SIZE);

  for (let b = 0; b < batches; b++) {
    const chunk = assignments.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);

    const submissions = chunk.map(a => ({
      blockId: a.blockId,
      blockType: blockTypes[Math.floor(Math.random() * blockTypes.length)],
      resourceUsage: 0.3 + Math.random() * 0.6,   // 0.3 – 0.9
      difficultyMultiplier: 1.0 + Math.random(),    // 1.0 – 2.0
      validationPassed: true,
      canaryAnswerCorrect: true,                     // Pass all canaries
    }));

    const res = await api('POST', '/work/submit', {
      accountId: node.accountId,
      nodeKey: node.nodeKey,
      submissions,
    });

    const results = (res.results ?? []) as Array<{ accepted: boolean }>;
    totalAccepted += results.filter(r => r.accepted).length;

    if (batches > 1) {
      process.stdout.write(`\r  ${node.accountId}: batch ${b + 1}/${batches} (${totalAccepted} accepted)`);
    }
  }
  console.log(`\r  ${node.accountId}: submitted ${assignments.length}, accepted ${totalAccepted}       `);
  return totalAccepted;
}

// ─── Step 5: Finalize ───────────────────────────────────────────
async function finalizeDay(): Promise<void> {
  console.log(`\n=== Finalizing day ===`);
  const res = await adminApi('POST', '/admin/day/finalize');
  const summary = res.summary as { activeContributors: number; totalEmissions: number; basePoolTotal: number; performancePoolTotal: number };
  const verification = res.verification as { valid: boolean };
  console.log(`  Verification:    ${verification.valid ? 'VALID' : 'FAILED'}`);
  console.log(`  Total emissions: ${summary.totalEmissions} tokens`);
  console.log(`  Base pool:       ${summary.basePoolTotal} tokens`);
  console.log(`  Performance:     ${summary.performancePoolTotal} tokens`);
  console.log(`  Contributors:    ${summary.activeContributors}`);
}

// ─── Step 6: Check balances ─────────────────────────────────────
async function checkBalances(nodes: NodeInfo[]): Promise<void> {
  console.log(`\n=== Token Balances ===`);
  for (const node of nodes) {
    try {
      const res = await api('GET', `/accounts/${node.accountId}/balance`);
      console.log(`  ${node.accountId}: ${res.balance} tokens (${res.balanceMicro} micro)`);
    } catch {
      console.log(`  ${node.accountId}: (no balance data)`);
    }
  }

  // Leaderboard
  const lb = await api('GET', '/accounts/leaderboard');
  const leaderboard = (lb.leaderboard ?? []) as Array<{ rank: number; accountId: string; balance: number; totalEarned: number }>;
  if (leaderboard.length > 0) {
    console.log(`\n=== Leaderboard ===`);
    for (const entry of leaderboard) {
      console.log(`  #${entry.rank} ${entry.accountId}: ${entry.totalEarned} earned, ${entry.balance} balance`);
    }
  }

  // Total supply
  const supply = await api('GET', '/accounts/supply');
  console.log(`\n=== Network Supply ===`);
  console.log(`  Total supply: ${supply.totalSupply} tokens`);
  console.log(`  Contributors: ${supply.contributorCount}`);
}

// ─── Main ───────────────────────────────────────────────────────
async function main() {
  console.log('AI4All Coin Generation Demo');
  console.log(`Server: ${BASE_URL}`);
  console.log(`Nodes:  ${NODE_COUNT}`);
  console.log(`Days:   ${DAY_COUNT}`);

  // Check server health
  try {
    const health = await api('GET', '/health');
    console.log(`Server status: ${health.status}, phase: ${health.dayPhase}`);
  } catch {
    console.error(`\nERROR: Cannot reach server at ${BASE_URL}`);
    console.error('Start the server first:  npm run start:api');
    process.exit(1);
  }

  // Register nodes
  const nodes = await registerNodes(NODE_COUNT);
  if (nodes.length === 0) {
    console.error('\nERROR: No nodes registered (all may already exist from a prior run).');
    console.error('Delete data/ai4all.db and restart the server for a clean run.');
    process.exit(1);
  }

  // Run day cycles
  for (let day = 1; day <= DAY_COUNT; day++) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`              DAY ${day} of ${DAY_COUNT}`);
    console.log(`${'='.repeat(50)}`);

    // Compute a dayId offset from today
    const d = new Date();
    d.setDate(d.getDate() - (DAY_COUNT - day));
    const dayId = d.toISOString().split('T')[0];

    // Start
    const { totalBlocks } = await startDay(dayId);

    // Request + submit work
    console.log(`\n--- Requesting work ---`);
    let totalAccepted = 0;
    for (const node of nodes) {
      const assignments = await requestWork(node);
      const accepted = await submitWork(node, assignments);
      totalAccepted += accepted;
    }
    console.log(`\n  Total accepted: ${totalAccepted} / ${totalBlocks}`);

    // Finalize
    await finalizeDay();
  }

  // Show final balances
  await checkBalances(nodes);

  console.log('\nDone! Coins have been generated.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

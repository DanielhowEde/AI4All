#!/usr/bin/env ts-node
/**
 * AI4All Blockchain Runner
 *
 * Full E2E flow with real ML-DSA-65 wallets:
 *   1. Generate wallets (or load existing ones)
 *   2. Register each wallet on the network
 *   3. Run day cycles: start -> request work -> submit -> finalize
 *   4. Check balances and chain status
 *
 * Usage:
 *   npm run run-blockchain
 *   npm run run-blockchain -- --wallets 3 --days 2
 *   npm run run-blockchain -- --load wallets/   (load existing wallets)
 *
 * Prerequisites:
 *   Server must be running: npm run start:api
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

// ─── Config ─────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

const BASE_URL = `http://localhost:${getArg('port', '3000')}`;
const ADMIN_KEY = process.env.ADMIN_KEY || 'test-admin-key';
const WALLET_COUNT = parseInt(getArg('wallets', '3'), 10);
const DAY_COUNT = parseInt(getArg('days', '1'), 10);
const WALLET_DIR = getArg('load', '') || getArg('out', 'wallets');
const LOAD_EXISTING = args.includes('--load');
const BATCH_SIZE = 200;

// ─── Types ──────────────────────────────────────────────────────
interface WalletIdentity {
  address: string;
  publicKey: string;
  secretKey: string;
  name: string;
  nodeKey?: string;
}

// ─── Helpers ────────────────────────────────────────────────────

/** Generate an ML-DSA-65 keypair via the ESM helper (WASM module is ESM-only) */
function generateWalletKeys(): { address: string; publicKey: string; secretKey: string } {
  const keygenScript = path.join(__dirname, 'keygen.mjs');
  const result = execFileSync('node', [keygenScript], { encoding: 'utf-8', timeout: 30_000 });
  return JSON.parse(result.trim());
}

async function api(method: string, urlPath: string, body?: unknown, headers?: Record<string, string>) {
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok && !(json as { success?: boolean }).success) {
    throw new Error(`${method} ${urlPath} -> ${res.status}: ${JSON.stringify(json)}`);
  }
  return json as Record<string, unknown>;
}

async function adminApi(method: string, urlPath: string, body?: unknown) {
  return api(method, urlPath, body, { 'X-Admin-Key': ADMIN_KEY });
}

// ─── Step 1: Generate or Load Wallets ───────────────────────────
function prepareWallets(): WalletIdentity[] {
  const wallets: WalletIdentity[] = [];
  const dir = path.resolve(WALLET_DIR);

  if (LOAD_EXISTING) {
    console.log(`\n=== Loading wallets from ${dir} ===`);
    if (!fs.existsSync(dir)) {
      console.error(`  ERROR: Directory not found: ${dir}`);
      process.exit(1);
    }
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.identity.json'));
    for (const file of files) {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
      wallets.push({
        address: data.address,
        publicKey: data.publicKey,
        secretKey: data.secretKey,
        name: data.name || data.address.slice(0, 12),
      });
      console.log(`  Loaded: ${data.address.slice(0, 20)}... (${data.name || file})`);
    }
  } else {
    console.log(`\n=== Generating ${WALLET_COUNT} ML-DSA-65 wallets ===`);
    fs.mkdirSync(dir, { recursive: true });

    for (let i = 1; i <= WALLET_COUNT; i++) {
      const { address, publicKey, secretKey } = generateWalletKeys();
      const name = `wallet-${i}`;

      const identity = {
        address,
        publicKey,
        secretKey,
        name,
        algorithm: 'ML-DSA-65',
        spec: 'FIPS 204',
        createdAt: new Date().toISOString(),
      };

      // Save to disk
      const filePath = path.join(dir, `${name}.identity.json`);
      fs.writeFileSync(filePath, JSON.stringify(identity, null, 2) + '\n');

      wallets.push({ address, publicKey, secretKey, name });
      console.log(`  ${name}: ${address.slice(0, 24)}...`);
    }
    console.log(`  Saved to ${dir}/`);
  }

  return wallets;
}

// ─── Step 2: Register Wallets ───────────────────────────────────
async function registerWallets(wallets: WalletIdentity[]): Promise<void> {
  console.log(`\n=== Registering ${wallets.length} wallets on the network ===`);

  for (const w of wallets) {
    try {
      const res = await api('POST', '/nodes/register', {
        accountId: w.address,
        publicKey: w.publicKey,
      });
      w.nodeKey = res.nodeKey as string;
      console.log(`  [+] ${w.name} (${w.address.slice(0, 20)}...) -> registered`);
    } catch (err: unknown) {
      const msg = (err as Error).message;
      if (msg.includes('409')) {
        console.log(`  [=] ${w.name} already registered (need nodeKey from prior run)`);
      } else {
        throw err;
      }
    }
  }
}

// ─── Step 3: Day Cycle ──────────────────────────────────────────
async function runDayCycle(
  wallets: WalletIdentity[],
  dayId: string,
): Promise<void> {
  // Start day
  console.log(`\n--- Starting day ${dayId} ---`);
  const startRes = await adminApi('POST', '/admin/day/start', { dayId });
  console.log(`  Blocks: ${startRes.totalBlocks}, Contributors: ${startRes.activeContributors}`);

  // Request + submit work for each wallet
  const blockTypes = ['INFERENCE', 'EMBEDDINGS', 'VALIDATION', 'TRAINING'];
  let totalSubmitted = 0;

  for (const w of wallets) {
    if (!w.nodeKey) {
      console.log(`  ${w.name}: skipped (no nodeKey)`);
      continue;
    }

    // Request work
    const workRes = await api('POST', '/work/request', {
      accountId: w.address,
      nodeKey: w.nodeKey,
    });
    const assignments = (workRes.assignments ?? []) as Array<{ blockId: string; batchNumber: number }>;

    if (assignments.length === 0) {
      console.log(`  ${w.name}: no assignments`);
      continue;
    }

    // Submit in batches
    let accepted = 0;
    const batches = Math.ceil(assignments.length / BATCH_SIZE);

    for (let b = 0; b < batches; b++) {
      const chunk = assignments.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
      const submissions = chunk.map(a => ({
        blockId: a.blockId,
        blockType: blockTypes[Math.floor(Math.random() * blockTypes.length)],
        resourceUsage: 0.3 + Math.random() * 0.6,
        difficultyMultiplier: 1.0 + Math.random(),
        validationPassed: true,
        canaryAnswerCorrect: true,
      }));

      const submitRes = await api('POST', '/work/submit', {
        accountId: w.address,
        nodeKey: w.nodeKey,
        submissions,
      });
      const results = (submitRes.results ?? []) as Array<{ accepted: boolean }>;
      accepted += results.filter(r => r.accepted).length;

      if (batches > 3) {
        process.stdout.write(`\r  ${w.name}: ${accepted}/${assignments.length} blocks...`);
      }
    }
    console.log(`\r  ${w.name}: ${accepted}/${assignments.length} blocks submitted       `);
    totalSubmitted += accepted;
  }

  console.log(`  Total: ${totalSubmitted} blocks submitted`);

  // Finalize
  console.log(`\n--- Finalizing day ${dayId} ---`);
  const finalRes = await adminApi('POST', '/admin/day/finalize');
  const summary = finalRes.summary as {
    activeContributors: number;
    totalEmissions: number;
    basePoolTotal: number;
    performancePoolTotal: number;
  };
  const verification = finalRes.verification as { valid: boolean; error?: string };

  console.log(`  Verification: ${verification.valid ? 'VALID' : 'FAILED' + (verification.error ? ' - ' + verification.error : '')}`);
  console.log(`  Emissions:    ${summary.totalEmissions} tokens`);
  console.log(`  Base pool:    ${summary.basePoolTotal} | Performance: ${summary.performancePoolTotal}`);
  console.log(`  Contributors: ${summary.activeContributors}`);
}

// ─── Step 4: Show Results ───────────────────────────────────────
async function showResults(wallets: WalletIdentity[]): Promise<void> {
  console.log(`\n${'='.repeat(56)}`);
  console.log('  BLOCKCHAIN STATUS');
  console.log(`${'='.repeat(56)}`);

  // Health
  const health = await api('GET', '/health');
  console.log(`\n  Server:     ${health.status}`);
  console.log(`  Day phase:  ${health.dayPhase}`);
  console.log(`  Day number: ${health.dayNumber}`);
  console.log(`  Nodes:      ${health.contributors}`);

  // Balances
  console.log(`\n  --- Wallet Balances ---`);
  for (const w of wallets) {
    try {
      const bal = await api('GET', `/accounts/${w.address}/balance`);
      console.log(`  ${w.name}: ${bal.balance} tokens (${w.address.slice(0, 20)}...)`);
    } catch {
      console.log(`  ${w.name}: (no balance)`);
    }
  }

  // Leaderboard
  const lb = await api('GET', '/accounts/leaderboard?limit=10');
  const board = (lb.leaderboard ?? []) as Array<{ rank: number; accountId: string; totalEarned: number; balance: number }>;
  if (board.length > 0) {
    console.log(`\n  --- Leaderboard ---`);
    for (const e of board) {
      console.log(`  #${e.rank} ${e.accountId.slice(0, 20)}... ${e.totalEarned} earned`);
    }
  }

  // Supply
  const supply = await api('GET', '/accounts/supply');
  console.log(`\n  --- Network Supply ---`);
  console.log(`  Total minted:       ${supply.totalSupply} tokens`);
  console.log(`  Daily emissions:    ${supply.dailyEmissions} tokens/day`);
  console.log(`  Active contributors: ${supply.contributorCount}`);
}

// ─── Main ───────────────────────────────────────────────────────
async function main() {
  console.log('=======================================================');
  console.log('  AI4All Blockchain Runner');
  console.log('=======================================================');
  console.log(`  Server:  ${BASE_URL}`);
  console.log(`  Wallets: ${LOAD_EXISTING ? 'loading from ' + WALLET_DIR : WALLET_COUNT + ' new'}`);
  console.log(`  Days:    ${DAY_COUNT}`);

  // Check server
  try {
    await api('GET', '/health');
  } catch {
    console.error(`\n  ERROR: Cannot reach server at ${BASE_URL}`);
    console.error('  Start it first:  npm run start:api\n');
    process.exit(1);
  }

  // Prepare wallets
  const wallets = prepareWallets();
  if (wallets.length === 0) {
    console.error('  No wallets available.');
    process.exit(1);
  }

  // Register
  await registerWallets(wallets);

  // Run days
  for (let d = 1; d <= DAY_COUNT; d++) {
    console.log(`\n${'='.repeat(56)}`);
    console.log(`  DAY ${d} of ${DAY_COUNT}`);
    console.log(`${'='.repeat(56)}`);

    const date = new Date();
    date.setDate(date.getDate() - (DAY_COUNT - d));
    const dayId = date.toISOString().split('T')[0];

    await runDayCycle(wallets, dayId);
  }

  // Results
  await showResults(wallets);

  console.log('\nBlockchain run complete.\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

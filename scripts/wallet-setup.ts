#!/usr/bin/env ts-node
/**
 * AI4All Wallet Setup CLI
 *
 * Manages ML-DSA-65 (post-quantum) wallet identities and registers them
 * with the AI4All network backend.
 *
 * Commands:
 *   create   Generate a new wallet and save it to wallets/
 *   list     List all local wallet files with their addresses
 *   register Register a wallet with the backend node server
 *   status   Show wallet info and live balance from the backend
 *
 * Examples:
 *   npx ts-node scripts/wallet-setup.ts create
 *   npx ts-node scripts/wallet-setup.ts create --name my-node
 *   npx ts-node scripts/wallet-setup.ts list
 *   npx ts-node scripts/wallet-setup.ts register --name my-node --api http://localhost:3000
 *   npx ts-node scripts/wallet-setup.ts status --name my-node --api http://localhost:3000
 */

import * as fs from 'fs';
import * as path from 'path';
import * as nodeCrypto from 'crypto';

// ── Paths ────────────────────────────────────────────────────────────

// process.cwd() is the repo root when running via npm scripts
const WALLETS_DIR = path.resolve(process.cwd(), 'wallets');
const DEFAULT_API = 'http://localhost:3000';

// ── Wallet identity format ───────────────────────────────────────────

interface WalletIdentity {
  address: string;
  publicKey: string;
  secretKey: string;
  name: string;
  createdAt: string;
}

// ── Argument parsing ─────────────────────────────────────────────────

interface Args {
  command: string;
  name?: string;
  api: string;
}

function parseArgs(argv: string[]): Args {
  const command = argv[0] ?? 'create';
  const args: Args = { command, api: DEFAULT_API };

  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--name' && argv[i + 1]) args.name = argv[++i];
    else if (argv[i] === '--api' && argv[i + 1]) args.api = argv[++i];
  }

  return args;
}

// ── Helpers ──────────────────────────────────────────────────────────

function listWalletFiles(): string[] {
  if (!fs.existsSync(WALLETS_DIR)) return [];
  return fs
    .readdirSync(WALLETS_DIR)
    .filter(f => f.endsWith('.identity.json'))
    .sort();
}

function loadWallet(name: string): WalletIdentity | null {
  const fp = path.join(WALLETS_DIR, `${name}.identity.json`);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf-8')) as WalletIdentity;
}

function nextAutoName(): string {
  const existing = listWalletFiles().map(f =>
    parseInt(f.replace('wallet-', '').replace('.identity.json', ''), 10)
  ).filter(n => !isNaN(n));
  const next = existing.length > 0 ? Math.max(...existing) + 1 : 1;
  return `wallet-${next}`;
}

async function apiPost(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function apiGet(url: string): Promise<unknown> {
  const res = await fetch(url);
  return res.json();
}

// ── Commands ─────────────────────────────────────────────────────────

async function cmdCreate(args: Args): Promise<void> {
  const name = args.name ?? nextAutoName();
  const walletFile = path.join(WALLETS_DIR, `${name}.identity.json`);

  if (fs.existsSync(walletFile)) {
    const existing = loadWallet(name)!;
    console.log(`\nWallet already exists: wallets/${name}.identity.json`);
    console.log(`  Address: ${existing.address}`);
    console.log(`  Created: ${existing.createdAt}`);
    console.log('\nUse --name <different-name> to create another wallet.');
    return;
  }

  console.log('\nGenerating ML-DSA-65 keypair (post-quantum, FIPS 204)...');

  // Generate ML-DSA-65 keypair directly using liboqs (ESM)
  const { createMLDSA65 } = await import('@openforge-sh/liboqs');
  const dsa = await createMLDSA65();
  const { publicKey, secretKey } = dsa.generateKeyPair();
  dsa.destroy();

  // Derive address: "ai4a" + hex(SHA256(pk)[0:20])
  const hash = nodeCrypto.createHash('sha256').update(Buffer.from(publicKey)).digest('hex');
  const address = 'ai4a' + hash.slice(0, 40);

  const identity: WalletIdentity = {
    address,
    publicKey: Buffer.from(publicKey).toString('hex'),
    secretKey: Buffer.from(secretKey).toString('hex'),
    name,
    createdAt: new Date().toISOString(),
  };

  fs.mkdirSync(WALLETS_DIR, { recursive: true });
  fs.writeFileSync(walletFile, JSON.stringify(identity, null, 2), 'utf-8');

  console.log('\n  Wallet created successfully!');
  console.log(`  File:    wallets/${name}.identity.json`);
  console.log(`  Name:    ${name}`);
  console.log(`  Address: ${address}`);
  console.log(`  Key:     ML-DSA-65 (1952-byte public, 4032-byte secret)`);
  console.log('\n  Next steps:');
  console.log(`    Register:  npm run wallet:register -- --name ${name}`);
  console.log(`    Status:    npm run wallet:status -- --name ${name}`);
  console.log(`\n  IMPORTANT: Keep wallets/${name}.identity.json safe.`);
  console.log('  The secret key cannot be recovered if lost.');
}

async function cmdList(_args: Args): Promise<void> {
  const files = listWalletFiles();

  if (files.length === 0) {
    console.log('\nNo wallets found in wallets/');
    console.log('  Create one with:  npm run wallet:create');
    return;
  }

  console.log(`\nFound ${files.length} wallet(s) in wallets/:\n`);
  console.log('  Name'.padEnd(20) + 'Address'.padEnd(46) + 'Created');
  console.log('  ' + '-'.repeat(80));

  for (const file of files) {
    const name = file.replace('.identity.json', '');
    const w = loadWallet(name);
    if (!w) continue;
    const created = new Date(w.createdAt).toLocaleDateString();
    console.log(`  ${w.name.padEnd(18)}  ${w.address.padEnd(44)}  ${created}`);
  }
}

async function cmdRegister(args: Args): Promise<void> {
  const name = args.name ?? (listWalletFiles()[0]?.replace('.identity.json', ''));

  if (!name) {
    console.error('\nNo wallets found. Create one first:  npm run wallet:create');
    process.exit(1);
  }

  const wallet = loadWallet(name);
  if (!wallet) {
    console.error(`\nWallet not found: ${name}`);
    console.error('  Run:  npm run wallet:list  to see available wallets');
    process.exit(1);
  }

  console.log(`\nRegistering wallet "${name}" with ${args.api} ...`);
  console.log(`  Address: ${wallet.address}`);

  let result: Record<string, unknown>;
  try {
    result = await apiPost(`${args.api}/nodes/register`, {
      accountId: wallet.address,
    }) as Record<string, unknown>;
  } catch (err) {
    console.error(`\n  Failed to connect to ${args.api}`);
    console.error('  Make sure the backend is running:  npm run start:api');
    process.exit(1);
  }

  if (result.success) {
    console.log('\n  Registration successful!');
    console.log(`  Node key:  ${result.nodeKey as string}`);
    console.log('\n  Save this node key — you will need it to submit work.');
    console.log(`  Add to your worker config:  coordinator.nodeKey = "${result.nodeKey as string}"`);
  } else if ((result.code as string) === 'DUPLICATE_NODE') {
    console.log('\n  Already registered — wallet is active on the network.');
  } else {
    console.error('\n  Registration failed:', result.error ?? result);
    process.exit(1);
  }
}

async function cmdStatus(args: Args): Promise<void> {
  const name = args.name ?? (listWalletFiles()[0]?.replace('.identity.json', ''));

  if (!name) {
    console.error('\nNo wallets found. Create one first:  npm run wallet:create');
    process.exit(1);
  }

  const wallet = loadWallet(name);
  if (!wallet) {
    console.error(`\nWallet not found: ${name}`);
    process.exit(1);
  }

  console.log(`\nWallet: ${name}`);
  console.log(`  Address: ${wallet.address}`);
  console.log(`  Created: ${wallet.createdAt}`);
  console.log(`  Key:     ML-DSA-65 (post-quantum)`);

  console.log(`\nChecking balance from ${args.api} ...`);

  let balance: Record<string, unknown>;
  try {
    balance = await apiGet(
      `${args.api}/accounts/${wallet.address}/balance`
    ) as Record<string, unknown>;
  } catch {
    console.log('  (backend not reachable — run  npm run start:api  to start)');
    return;
  }

  if (!balance.success) {
    if ((balance.code as string) === 'NODE_NOT_FOUND') {
      console.log('\n  Not registered on the network yet.');
      console.log(`  Register with:  npm run wallet:register -- --name ${name}`);
    } else {
      console.log('  Balance unavailable:', balance.error);
    }
    return;
  }

  const tokens = balance.balance as number;
  const earned = balance.totalEarned as number;
  const lastDay = (balance.lastRewardDay as string) ?? 'never';

  console.log('\n  Balance:       ' + tokens.toFixed(9) + ' AI4A');
  console.log('  Total earned:  ' + earned.toFixed(9) + ' AI4A');
  console.log('  Last reward:   ' + lastDay);
  console.log(`\n  History:  curl ${args.api}/accounts/${wallet.address}/history`);
}

// ── Entry point ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  console.log('AI4All Wallet Setup');
  console.log('══════════════════');

  switch (args.command) {
    case 'create':  await cmdCreate(args);   break;
    case 'list':    await cmdList(args);     break;
    case 'register': await cmdRegister(args); break;
    case 'status':  await cmdStatus(args);   break;
    default:
      console.log('\nUsage: npx ts-node scripts/wallet-setup.ts <command> [options]');
      console.log('\nCommands:');
      console.log('  create    Generate a new ML-DSA-65 wallet');
      console.log('  list      List all local wallets');
      console.log('  register  Register a wallet with the backend');
      console.log('  status    Show wallet info and balance');
      console.log('\nOptions:');
      console.log('  --name <n>   Wallet name (default: wallet-N)');
      console.log('  --api <url>  Backend URL (default: http://localhost:3000)');
      console.log('\nExamples:');
      console.log('  npx ts-node scripts/wallet-setup.ts create');
      console.log('  npx ts-node scripts/wallet-setup.ts create --name my-node');
      console.log('  npx ts-node scripts/wallet-setup.ts list');
      console.log('  npx ts-node scripts/wallet-setup.ts register --name my-node');
      console.log('  npx ts-node scripts/wallet-setup.ts status --name my-node');
  }
}

main().catch(err => {
  console.error('\nError:', err instanceof Error ? err.message : err);
  process.exit(1);
});

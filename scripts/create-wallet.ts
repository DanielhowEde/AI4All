#!/usr/bin/env ts-node
/**
 * AI4All Wallet Generator
 *
 * Generates an ML-DSA-65 (FIPS 204) keypair and derives an ai4a... address.
 * Saves the wallet identity to a JSON file for use with the blockchain.
 *
 * Usage:
 *   npm run create-wallet
 *   npm run create-wallet -- --name my-node
 *   npm run create-wallet -- --out wallets/
 *
 * Output: A JSON identity file with:
 *   - address:    ai4a... (44-char network address, used as accountId)
 *   - publicKey:  hex-encoded ML-DSA-65 public key (1952 bytes -> 3904 hex)
 *   - secretKey:  hex-encoded ML-DSA-65 secret key (4032 bytes -> 8064 hex)
 *   - createdAt:  ISO timestamp
 */

import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';

/** Generate an ML-DSA-65 keypair via the ESM helper (WASM module is ESM-only) */
function generateWalletKeys(): { address: string; publicKey: string; secretKey: string } {
  const keygenScript = path.join(__dirname, 'keygen.mjs');
  const result = execFileSync('node', [keygenScript], { encoding: 'utf-8', timeout: 30_000 });
  return JSON.parse(result.trim());
}

async function main() {
  const args = process.argv.slice(2);
  const nameIdx = args.indexOf('--name');
  const outIdx = args.indexOf('--out');

  const walletName = nameIdx >= 0 ? args[nameIdx + 1] : undefined;
  const outDir = outIdx >= 0 ? args[outIdx + 1] : 'wallets';

  console.log('Generating ML-DSA-65 keypair (FIPS 204, NIST Level 3)...');

  const { address, publicKey, secretKey } = generateWalletKeys();

  console.log(`  Public key:  ${publicKey.length / 2} bytes (${publicKey.length} hex chars)`);
  console.log(`  Secret key:  ${secretKey.length / 2} bytes (${secretKey.length} hex chars)`);
  console.log(`  Address:     ${address}`);

  // Build identity object
  const identity = {
    address,
    publicKey,
    secretKey,
    createdAt: new Date().toISOString(),
    name: walletName ?? address.slice(0, 12),
    algorithm: 'ML-DSA-65',
    spec: 'FIPS 204',
  };

  // Ensure output directory exists
  const resolvedDir = path.resolve(outDir);
  fs.mkdirSync(resolvedDir, { recursive: true });

  // Save identity file
  const fileName = walletName
    ? `${walletName}.identity.json`
    : `${address.slice(0, 16)}.identity.json`;
  const filePath = path.join(resolvedDir, fileName);

  fs.writeFileSync(filePath, JSON.stringify(identity, null, 2) + '\n');

  console.log(`\n  Wallet saved to: ${filePath}`);
  console.log(`\n  IMPORTANT: Keep the secret key safe! Anyone with it can sign as you.`);
  console.log(`  The address "${address}" is your accountId on the network.\n`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

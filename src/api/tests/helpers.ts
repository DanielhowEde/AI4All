/**
 * Test helpers for signature-based worker authentication.
 *
 * Generates real-sized ML-DSA-65 keypairs (via the Jest mock) and derives
 * addresses exactly as the production code does.
 */

import * as nodeCrypto from 'crypto';
import { sign } from '../../crypto/signing';

export interface TestNode {
  accountId: string;
  publicKeyHex: string;
  secretKeyHex: string;
}

/**
 * Generate an ML-DSA-65 keypair and derive the canonical AI4All address.
 * Uses the same derivation as wallet-setup.ts: "ai4a" + hex(SHA256(pk)[0:20])
 */
export async function makeTestNode(): Promise<TestNode> {
  const { createMLDSA65 } = await import('@openforge-sh/liboqs');
  const dsa = await createMLDSA65();
  const { publicKey, secretKey } = dsa.generateKeyPair();
  dsa.destroy();

  const publicKeyHex = Buffer.from(publicKey).toString('hex');
  const secretKeyHex = Buffer.from(secretKey).toString('hex');
  const hash = nodeCrypto.createHash('sha256').update(Buffer.from(publicKey)).digest('hex');
  const accountId = 'ai4a' + hash.slice(0, 40);

  return { accountId, publicKeyHex, secretKeyHex };
}

/**
 * Sign a worker request with the current timestamp.
 * Message format: "AI4ALL:v1:{accountId}:{isoTimestamp}"
 */
export async function signWorkerRequest(
  accountId: string,
  secretKeyHex: string,
): Promise<{ timestamp: string; signature: string }> {
  const timestamp = new Date().toISOString();
  const message = new TextEncoder().encode(`AI4ALL:v1:${accountId}:${timestamp}`);
  const sig = await sign(message, new Uint8Array(Buffer.from(secretKeyHex, 'hex')));
  return { timestamp, signature: Buffer.from(sig).toString('hex') };
}

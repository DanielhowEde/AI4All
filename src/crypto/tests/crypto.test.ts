/**
 * Crypto Module Tests
 *
 * 1. Deterministic address from pubkey
 * 2. Invalid signature rejected
 * 3. Cross-process verify (serialize → deserialize → verify)
 */

import { generateKeyPair } from '../keys';
import { sign, verify } from '../signing';
import { deriveAddress } from '../address';

// WASM init is slow; share one keypair across tests
let publicKey: Uint8Array;
let secretKey: Uint8Array;

beforeAll(async () => {
  const kp = await generateKeyPair();
  publicKey = kp.publicKey;
  secretKey = kp.secretKey;
}, 30_000); // WASM init can take time

describe('deriveAddress', () => {
  it('produces the same address for the same public key', () => {
    const addr1 = deriveAddress(publicKey);
    const addr2 = deriveAddress(publicKey);
    expect(addr1).toBe(addr2);
  });

  it('returns a 44-character string with ai4a prefix', () => {
    const addr = deriveAddress(publicKey);
    expect(addr).toHaveLength(44);
    expect(addr.startsWith('ai4a')).toBe(true);
  });

  it('produces different addresses for different keys', async () => {
    const kp2 = await generateKeyPair();
    const addr1 = deriveAddress(publicKey);
    const addr2 = deriveAddress(kp2.publicKey);
    expect(addr1).not.toBe(addr2);
  }, 30_000);
});

describe('sign / verify', () => {
  const message = new TextEncoder().encode('hello ai4all');

  it('rejects a tampered signature', async () => {
    const signature = await sign(message, secretKey);

    // Flip a byte in the middle of the signature
    const tampered = new Uint8Array(signature);
    tampered[Math.floor(tampered.length / 2)] ^= 0xff;

    const valid = await verify(message, tampered, publicKey);
    expect(valid).toBe(false);
  }, 30_000);

  it('rejects a signature for a different message', async () => {
    const signature = await sign(message, secretKey);
    const otherMessage = new TextEncoder().encode('wrong message');

    const valid = await verify(otherMessage, signature, publicKey);
    expect(valid).toBe(false);
  }, 30_000);
});

describe('cross-process verify', () => {
  it('verifies after hex round-trip (simulated cross-process)', async () => {
    const message = new TextEncoder().encode('cross-process payload');
    const signature = await sign(message, secretKey);

    // Serialize to hex (as if sending over network / writing to disk)
    const pubHex = Buffer.from(publicKey).toString('hex');
    const sigHex = Buffer.from(signature).toString('hex');
    const msgHex = Buffer.from(message).toString('hex');

    // Deserialize (as if a separate process reads them back)
    const pubKey2 = new Uint8Array(Buffer.from(pubHex, 'hex'));
    const sig2 = new Uint8Array(Buffer.from(sigHex, 'hex'));
    const msg2 = new Uint8Array(Buffer.from(msgHex, 'hex'));

    const valid = await verify(msg2, sig2, pubKey2);
    expect(valid).toBe(true);
  }, 30_000);
});

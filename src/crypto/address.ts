/**
 * Address Derivation from Public Key
 *
 * Derives a deterministic network address from an ML-DSA-65 public key.
 * Algorithm: SHA-256(publicKey) → first 20 bytes → hex → prefix "ai4a"
 * Result: 44-character string (4-char prefix + 40 hex chars)
 */

import { sha256 } from '../merkle/merkleTree';

const ADDRESS_PREFIX = 'ai4a';
const HASH_BYTES = 20;

/**
 * Derive a network address from a public key.
 *
 * Deterministic: same public key always produces the same address.
 *
 * @param publicKey  ML-DSA-65 public key (1952 bytes)
 * @returns 44-character address string (e.g. "ai4a3a7b2c...")
 */
export function deriveAddress(publicKey: Uint8Array): string {
  const hash = sha256(Buffer.from(publicKey));
  const truncated = hash.slice(0, HASH_BYTES * 2); // hex string, 2 chars per byte
  return ADDRESS_PREFIX + truncated;
}

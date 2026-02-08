/**
 * AI4All Crypto Module
 *
 * Single entry point for all cryptographic operations:
 * - ML-DSA-65 keypair generation (FIPS 204)
 * - Digital signature sign / verify
 * - Address derivation from public key
 */

export { generateKeyPair } from './keys';
export type { KeyPair } from './keys';
export { sign, verify } from './signing';
export { deriveAddress } from './address';

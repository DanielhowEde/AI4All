/**
 * ML-DSA-65 Keypair Generation (FIPS 204)
 *
 * Post-quantum digital signature keypair generation using
 * ML-DSA-65 (NIST Level 3, 192-bit quantum security).
 */

export interface KeyPair {
  publicKey: Uint8Array;  // 1952 bytes
  secretKey: Uint8Array;  // 4032 bytes
}

/**
 * Generate an ML-DSA-65 keypair.
 *
 * Creates a new public/secret key pair suitable for signing and verification.
 * The secret key must be kept confidential.
 *
 * @returns Promise resolving to { publicKey, secretKey }
 */
export async function generateKeyPair(): Promise<KeyPair> {
  const { createMLDSA65 } = await import('@openforge-sh/liboqs');
  const dsa = await createMLDSA65();
  try {
    const { publicKey, secretKey } = dsa.generateKeyPair();
    return { publicKey, secretKey };
  } finally {
    dsa.destroy();
  }
}

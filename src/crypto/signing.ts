/**
 * ML-DSA-65 Sign / Verify (FIPS 204)
 *
 * Digital signature creation and verification using ML-DSA-65.
 */

/**
 * Sign a message using an ML-DSA-65 secret key.
 *
 * @param message  Arbitrary-length message bytes
 * @param secretKey  Secret key (4032 bytes) from generateKeyPair()
 * @returns Signature bytes (up to 3309 bytes)
 */
export async function sign(
  message: Uint8Array,
  secretKey: Uint8Array,
): Promise<Uint8Array> {
  const { createMLDSA65 } = await import('@openforge-sh/liboqs');
  const dsa = await createMLDSA65();
  try {
    return dsa.sign(message, secretKey);
  } finally {
    dsa.destroy();
  }
}

/**
 * Verify an ML-DSA-65 signature against a message and public key.
 *
 * @param message    Original message that was signed
 * @param signature  Signature to verify
 * @param publicKey  Public key (1952 bytes) from generateKeyPair()
 * @returns true if signature is valid
 */
export async function verify(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  const { createMLDSA65 } = await import('@openforge-sh/liboqs');
  const dsa = await createMLDSA65();
  try {
    return dsa.verify(message, signature, publicKey);
  } finally {
    dsa.destroy();
  }
}

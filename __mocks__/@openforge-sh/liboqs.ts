/**
 * Jest mock for @openforge-sh/liboqs (ESM WASM module).
 *
 * Uses Node.js crypto HMAC under the hood. NOT real PQ crypto — test only.
 * The keypair embeds a shared 32-byte secret at offset 0 in both pk and sk,
 * so sign(msg, sk) and verify(msg, sig, pk) are consistent.
 */
import * as crypto from 'crypto';

const PK_SIZE = 1952;
const SK_SIZE = 4032;
const SIG_SIZE = 3309;
const HMAC_KEY_SIZE = 32;

function hmacSign(message: Uint8Array, hmacKey: Uint8Array): Uint8Array {
  const hmac = crypto.createHmac('sha256', Buffer.from(hmacKey));
  hmac.update(Buffer.from(message));
  const digest = hmac.digest();
  // Pad to SIG_SIZE with repeating digest
  const sig = Buffer.alloc(SIG_SIZE);
  for (let i = 0; i < SIG_SIZE; i++) {
    sig[i] = digest[i % digest.length];
  }
  return new Uint8Array(sig);
}

function hmacVerify(message: Uint8Array, signature: Uint8Array, hmacKey: Uint8Array): boolean {
  const expected = hmacSign(message, hmacKey);
  if (expected.length !== signature.length) return false;
  return Buffer.from(expected).equals(Buffer.from(signature));
}

export async function createMLDSA65() {
  return {
    generateKeyPair() {
      // Generate shared HMAC key
      const hmacKey = crypto.randomBytes(HMAC_KEY_SIZE);

      // Embed HMAC key at offset 0 of both pk and sk (padded)
      const publicKey = new Uint8Array(PK_SIZE);
      publicKey.set(hmacKey, 0);
      crypto.randomFillSync(publicKey, HMAC_KEY_SIZE);

      const secretKey = new Uint8Array(SK_SIZE);
      // Copy the same HMAC key into sk at offset 0
      secretKey.set(hmacKey, 0);
      crypto.randomFillSync(secretKey, HMAC_KEY_SIZE);

      return { publicKey, secretKey };
    },

    sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
      const hmacKey = secretKey.slice(0, HMAC_KEY_SIZE);
      return hmacSign(message, hmacKey);
    },

    verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
      const hmacKey = publicKey.slice(0, HMAC_KEY_SIZE);
      return hmacVerify(message, signature, hmacKey);
    },

    destroy() {
      // no-op
    },
  };
}

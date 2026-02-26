/**
 * Signature-based worker authentication.
 *
 * Workers prove identity by signing a canonical message with their ML-DSA-65
 * secret key. The server verifies against the stored public key. No shared
 * secrets are stored server-side.
 *
 * Message format: "AI4ALL:v1:{accountId}:{isoTimestamp}"
 * Timestamp window: ±30 seconds (prevents replay attacks)
 */

import { verify } from '../crypto/signing';
import type { Response } from 'express';
import { ErrorCodes } from './types';

export const AUTH_WINDOW_MS = 30_000; // ±30 seconds

export function buildWorkerMessage(accountId: string, timestamp: string): Uint8Array {
  return new TextEncoder().encode(`AI4ALL:v1:${accountId}:${timestamp}`);
}

/**
 * Verify a worker's ML-DSA-65 signature. Sends an HTTP error response and
 * returns false if verification fails; returns true on success.
 */
export async function verifyWorkerAuth(
  publicKeys: Map<string, string>,
  accountId: string,
  timestamp: string | undefined,
  signatureHex: string | undefined,
  res: Response,
): Promise<boolean> {
  if (!timestamp || !signatureHex) {
    res.status(401).json({
      success: false,
      error: 'Missing timestamp or signature',
      code: ErrorCodes.INVALID_SIGNATURE,
    });
    return false;
  }

  const ts = new Date(timestamp).getTime();
  if (isNaN(ts) || Math.abs(Date.now() - ts) > AUTH_WINDOW_MS) {
    res.status(401).json({
      success: false,
      error: 'Timestamp expired or invalid (±30s window)',
      code: ErrorCodes.INVALID_SIGNATURE,
    });
    return false;
  }

  const publicKeyHex = publicKeys.get(accountId);
  if (!publicKeyHex) {
    res.status(404).json({
      success: false,
      error: `Node not found: ${accountId}`,
      code: ErrorCodes.NODE_NOT_FOUND,
    });
    return false;
  }

  const message = buildWorkerMessage(accountId, timestamp);
  let valid: boolean;
  try {
    valid = await verify(
      message,
      Buffer.from(signatureHex, 'hex'),
      Buffer.from(publicKeyHex, 'hex'),
    );
  } catch {
    valid = false;
  }

  if (!valid) {
    res.status(401).json({
      success: false,
      error: 'Invalid signature',
      code: ErrorCodes.INVALID_SIGNATURE,
    });
    return false;
  }

  return true;
}

import { Request, Response, NextFunction } from 'express';
import { ErrorCodes } from '../types';

const ADMIN_KEY_HEADER = 'x-admin-key';

/**
 * Get the admin key from environment or use default for testing
 */
export function getAdminKey(): string {
  return process.env.ADMIN_KEY || 'test-admin-key';
}

/**
 * Middleware to validate X-Admin-Key header for admin endpoints
 */
export function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  const providedKey = req.header(ADMIN_KEY_HEADER);

  if (!providedKey) {
    res.status(401).json({
      success: false,
      error: 'Missing X-Admin-Key header',
      code: ErrorCodes.MISSING_ADMIN_KEY,
    });
    return;
  }

  const expectedKey = getAdminKey();
  if (providedKey !== expectedKey) {
    res.status(401).json({
      success: false,
      error: 'Invalid admin key',
      code: ErrorCodes.INVALID_ADMIN_KEY,
    });
    return;
  }

  next();
}

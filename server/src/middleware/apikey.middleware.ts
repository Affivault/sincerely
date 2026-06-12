import { Request, Response, NextFunction } from 'express';
import { validateKey } from '../services/apikey.service.js';

export interface ApiKeyRequest extends Request {
  userId?: string;
  userEmail?: string;
  apiKeyScopes?: string[];
  apiKeyRateLimit?: number;
  authMethod?: 'jwt' | 'apikey';
}

/**
 * API Key Authentication Middleware
 *
 * Validates incoming requests that use API key authentication (Bearer sk_live_...).
 * This middleware is used INSTEAD of the JWT auth middleware for API key access.
 *
 * Usage: Mount this before the JWT auth middleware in the chain.
 * If the request has an API key, it handles auth. Otherwise, it passes through
 * to the next middleware (JWT auth).
 */
export async function apiKeyMiddleware(req: ApiKeyRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  // Only handle API key tokens (sk_live_ prefix)
  if (!authHeader || !authHeader.startsWith('Bearer sk_live_')) {
    // Not an API key - pass through to JWT auth middleware
    next();
    return;
  }

  const rawKey = authHeader.split(' ')[1];

  try {
    const result = await validateKey(rawKey);
    if (!result) {
      res.status(401).json({ error: 'Invalid or expired API key' });
      return;
    }
    req.userId = result.userId;
    req.authMethod = 'apikey';
    req.apiKeyScopes = result.scopes;
    req.apiKeyRateLimit = result.rateLimit;
    next();
  } catch {
    res.status(500).json({ error: 'API key validation error' });
  }
}

/**
 * Scope check middleware factory.
 * Ensures the API key (if used) has the required scope.
 *
 * Usage: router.get('/data', requireScope('read'), handler);
 */
export function requireScope(scope: string) {
  return (req: ApiKeyRequest, res: Response, next: NextFunction): void => {
    // JWT auth has full access
    if (req.authMethod !== 'apikey') {
      next();
      return;
    }

    // API key must have the required scope
    if (!req.apiKeyScopes || !req.apiKeyScopes.includes(scope)) {
      res.status(403).json({
        error: `API key lacks required scope: ${scope}`,
        required_scope: scope,
        available_scopes: req.apiKeyScopes || [],
      });
      return;
    }

    next();
  };
}

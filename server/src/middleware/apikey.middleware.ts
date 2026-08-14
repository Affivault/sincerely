import { Request, Response, NextFunction } from 'express';
import { validateKey } from '../services/apikey.service.js';

export interface ApiKeyRequest extends Request {
  userId?: string;
  userEmail?: string;
  apiKeyId?: string;
  apiKeyScopes?: string[];
  apiKeyRateLimit?: number;
  authMethod?: 'jwt' | 'apikey';
}

// Per-key fixed-window request counter (requests per rolling minute). This is
// in-process only — fine for a single server instance; a multi-instance
// deployment would need a shared store (e.g. Redis) instead.
const RATE_WINDOW_MS = 60_000;
const requestCounts = new Map<string, { count: number; windowStart: number }>();

// Entries for keys that stop being used are never touched again after their window
// closes — sweep them out periodically so the map doesn't grow for the life of the process.
setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS;
  for (const [keyId, entry] of requestCounts) {
    if (entry.windowStart < cutoff) requestCounts.delete(keyId);
  }
}, RATE_WINDOW_MS).unref();

interface RateVerdict {
  limited: boolean;
  retryAfterSeconds: number;
  /** Requests still allowed in this window. */
  remaining: number;
  /** Seconds until the window rolls over and the budget is restored. */
  resetSeconds: number;
}

function isRateLimited(keyId: string, limit: number): RateVerdict {
  const now = Date.now();
  const entry = requestCounts.get(keyId);

  if (!entry || now - entry.windowStart >= RATE_WINDOW_MS) {
    requestCounts.set(keyId, { count: 1, windowStart: now });
    const resetSeconds = Math.ceil(RATE_WINDOW_MS / 1000);
    if (limit < 1) {
      return { limited: true, retryAfterSeconds: resetSeconds, remaining: 0, resetSeconds };
    }
    return { limited: false, retryAfterSeconds: 0, remaining: Math.max(0, limit - 1), resetSeconds };
  }

  entry.count += 1;
  const resetSeconds = Math.max(1, Math.ceil((entry.windowStart + RATE_WINDOW_MS - now) / 1000));
  if (entry.count > limit) {
    return { limited: true, retryAfterSeconds: resetSeconds, remaining: 0, resetSeconds };
  }
  return { limited: false, retryAfterSeconds: 0, remaining: Math.max(0, limit - entry.count), resetSeconds };
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

    const { limited, retryAfterSeconds, remaining, resetSeconds } = isRateLimited(result.keyId, result.rateLimit);

    /* Publish the budget on every reply, not only when it runs out.
     *
     * A client that can only discover the limit by hitting it has no way to
     * pace itself, and the Chrome extension's ordinary work is bursty by
     * nature — one "add this person" is up to seven requests, so a handful of
     * adds walks into the wall. It then reported "rate limit reached" as a
     * hard failure for something that would have worked seconds later.
     * With these it can slow down before the wall instead. */
    res.setHeader('X-RateLimit-Limit', String(result.rateLimit));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(resetSeconds));

    if (limited) {
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({ error: 'Rate limit exceeded', rate_limit: result.rateLimit, retry_after_seconds: retryAfterSeconds });
      return;
    }

    req.userId = result.userId;
    req.userEmail = result.userEmail ?? undefined;
    req.authMethod = 'apikey';
    req.apiKeyId = result.keyId;
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

/**
 * Central scope gate for every /api/v1 route: a GET/HEAD needs the 'read'
 * scope, anything else needs 'write'. Mount after apiKeyMiddleware +
 * authMiddleware so req.authMethod/apiKeyScopes are populated. JWT-authed
 * requests always pass through untouched.
 */
export function enforceApiKeyScope(req: ApiKeyRequest, res: Response, next: NextFunction): void {
  if (req.authMethod !== 'apikey') {
    next();
    return;
  }

  const requiredScope = req.method === 'GET' || req.method === 'HEAD' ? 'read' : 'write';
  if (!req.apiKeyScopes || !req.apiKeyScopes.includes(requiredScope)) {
    res.status(403).json({
      error: `API key lacks required scope: ${requiredScope}`,
      required_scope: requiredScope,
      available_scopes: req.apiKeyScopes || [],
    });
    return;
  }

  next();
}

/**
 * Blocks API-key authentication entirely. For account-security-sensitive
 * endpoints (password changes, account deletion, API key management) that
 * must stay reachable only from a real user session — a leaked or
 * intentionally scoped-down API key must never be able to reach them, no
 * matter what scopes it carries.
 */
export function jwtOnly(req: ApiKeyRequest, res: Response, next: NextFunction): void {
  if (req.authMethod === 'apikey') {
    res.status(403).json({ error: 'This endpoint requires a user session; API keys are not accepted here' });
    return;
  }
  next();
}

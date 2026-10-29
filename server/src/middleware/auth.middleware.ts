import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';
import { accountControls, ACCOUNT_SUSPENDED } from '../services/account-controls.service.js';
import { isOwnerEmail } from '../config/admin.js';
import { viewAs } from '../services/view-as.service.js';

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
}

/**
 * A suspended account is turned away whichever way it signed in, and a
 * token issued before the owner signed the account out everywhere is
 * refused. The owner never is.
 */
async function admit(req: AuthRequest, res: Response, next: NextFunction, issuedAt?: number): Promise<void> {
  if (req.userId && !isOwnerEmail(req.userEmail)) {
    if (await accountControls.isSuspended(req.userId)) {
      res.status(403).json({ error: ACCOUNT_SUSPENDED, code: 'ACCOUNT_SUSPENDED' });
      return;
    }
    if (issuedAt !== undefined && await accountControls.isRevoked(req.userId, issuedAt)) {
      res.status(401).json({ error: 'You have been signed out. Please sign in again.' });
      return;
    }
  }
  next();
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  // If API key middleware already authenticated, skip JWT validation
  if (req.userId && (req as any).authMethod === 'apikey') {
    await admit(req, res, next);
    return;
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.split(' ')[1];

  // The owner viewing the app as an account: read-only, and short-lived.
  const viewing = viewAs.verify(token);
  if (viewing) {
    if (!READ_METHODS.has(req.method)) {
      res.status(403).json({ error: 'Read-only: you are viewing this account as the admin, so nothing can be changed.', code: 'VIEW_AS_READ_ONLY' });
      return;
    }
    req.userId = viewing.sub;
    req.userEmail = viewing.email;
    (req as any).viewAsBy = viewing.act;
    next();
    return;
  }

  try {
    if (env.SUPABASE_JWT_SECRET) {
      // Fast path: verify the signature locally with the configured secret.
      try {
        const decoded = jwt.verify(token, env.SUPABASE_JWT_SECRET) as {
          sub: string;
          email: string;
          exp: number;
          iat?: number;
        };
        if (decoded?.sub) {
          req.userId = decoded.sub;
          req.userEmail = decoded.email;
          await admit(req, res, next, decoded.iat ?? 0);
          return;
        }
      } catch {
        // Local verification failed — wrong/rotated secret, or this Supabase
        // project signs tokens asymmetrically (the JWT Secret can't verify
        // them). Fall through to authoritative Supabase validation rather than
        // locking the user out. (A genuinely forged token is still rejected
        // below, so this is not a security hole.)
      }
    }

    // Validate the token with Supabase itself. Authoritative, and works
    // regardless of the signing scheme. We never trust an unverified decode.
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    req.userId = data.user.id;
    req.userEmail = data.user.email ?? '';
    const iat = (jwt.decode(token) as { iat?: number } | null)?.iat;
    await admit(req, res, next, iat ?? 0);
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware.js';
import { ADMIN_EMAILS } from '@lemlist/shared';

/**
 * Platform-owner gate. Only the hardcoded admin account(s) pass; everyone
 * else gets a 404 — the admin surface shouldn't even appear to exist.
 * The check is by authenticated email (set by auth middleware from the
 * verified JWT / Supabase session), never by anything client-supplied.
 */
export function adminOnly(req: AuthRequest, res: Response, next: NextFunction) {
  const email = (req.userEmail || '').trim().toLowerCase();
  if (!email || !ADMIN_EMAILS.includes(email)) {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
}

import { createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

/*
 * "View as this user": a short-lived token the owner's browser uses in place
 * of their own, so the app shows exactly what that account sees. It is
 * signed with a key of our own (not Supabase's), carries who is viewing,
 * and the auth middleware lets it read and nothing else.
 */

const ISSUER = 'sincerely-view-as';
export const VIEW_AS_MINUTES = 30;

const key = () => createHmac('sha256', env.ENCRYPTION_KEY).update('admin-view-as').digest('hex');

export interface ViewAsClaims { sub: string; email: string; act: string }

export const viewAs = {
  mint(userId: string, email: string, actorEmail: string): { token: string; expires_at: string } {
    const token = jwt.sign({ sub: userId, email, act: actorEmail }, key(), { issuer: ISSUER, expiresIn: `${VIEW_AS_MINUTES}m` });
    return { token, expires_at: new Date(Date.now() + VIEW_AS_MINUTES * 60_000).toISOString() };
  },

  /** The claims if this is a valid view-as token, else null (any other token, or a forged or expired one). */
  verify(token: string): ViewAsClaims | null {
    const peek = jwt.decode(token) as { iss?: string } | null;
    if (peek?.iss !== ISSUER) return null;
    try {
      const claims = jwt.verify(token, key(), { issuer: ISSUER, algorithms: ['HS256'] }) as ViewAsClaims;
      return claims?.sub && claims.act ? claims : null;
    } catch {
      return null;
    }
  },
};

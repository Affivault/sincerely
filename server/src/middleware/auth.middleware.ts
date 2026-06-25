import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  // If API key middleware already authenticated, skip JWT validation
  if (req.userId && (req as any).authMethod === 'apikey') {
    next();
    return;
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    if (env.SUPABASE_JWT_SECRET) {
      // Fast path: verify the signature locally with the configured secret.
      try {
        const decoded = jwt.verify(token, env.SUPABASE_JWT_SECRET) as {
          sub: string;
          email: string;
          exp: number;
        };
        if (decoded?.sub) {
          req.userId = decoded.sub;
          req.userEmail = decoded.email;
          next();
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
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

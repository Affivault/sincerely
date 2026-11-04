/*
 * What Settings > Developer shows about the public API: where it lives,
 * and the request log (migration 115). Session only: these are for the
 * person looking at the app, never for an API key.
 */
import type { NextFunction, Response } from 'express';
import { PUBLIC_API_VERSION } from '@lemlist/shared';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';

export function publicApiBase(): string {
  return `${env.API_BASE_URL.replace(/\/+$/, '')}/v1`;
}

export const developerController = {
  info(_req: AuthRequest, res: Response) {
    res.json({ base_url: publicApiBase(), openapi_url: `${publicApiBase()}/openapi.json`, version: PUBLIC_API_VERSION });
  },

  async requestLog(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.userId!;
      const errorsOnly = req.query.errors === '1';
      const keyId = typeof req.query.key === 'string' && /^[0-9a-f-]{36}$/i.test(req.query.key) ? req.query.key : null;

      let q = supabaseAdmin.from('api_request_log')
        .select('id, api_key_id, request_id, method, path, status, duration_ms, error_code, user_agent, created_at')
        .eq('user_id', userId).order('id', { ascending: false }).limit(100);
      if (errorsOnly) q = q.gte('status', 400);
      if (keyId) q = q.eq('api_key_id', keyId);
      const { data, error } = await q;
      if (error) {
        if (error.code === '42P01' || error.code === 'PGRST205' || /api_request_log/.test(error.message)) {
          res.json({ setup_needed: true, rows: [], last_day: { requests: 0, errors: 0 } });
          return;
        }
        throw error;
      }

      const since = new Date(Date.now() - 86400_000).toISOString();
      const [all, failed, keys] = await Promise.all([
        supabaseAdmin.from('api_request_log').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', since),
        supabaseAdmin.from('api_request_log').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', since).gte('status', 400),
        supabaseAdmin.from('api_keys').select('id, name').eq('user_id', userId),
      ]);
      const names = new Map((keys.data || []).map((k: any) => [k.id, k.name]));
      res.json({
        setup_needed: false,
        rows: (data || []).map((r: any) => ({ ...r, key_name: r.api_key_id ? names.get(r.api_key_id) ?? null : null })),
        last_day: { requests: all.count || 0, errors: failed.count || 0 },
      });
    } catch (err) { next(err); }
  },
};

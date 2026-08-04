import { Router, Request, Response } from 'express';
import { env } from '../config/env.js';
import { handleOAuthCallback } from '../services/integrations-oauth.service.js';

/**
 * PUBLIC routes — the browser lands here on redirect from the provider's
 * consent screen, with no Authorization header. Identity comes from the
 * HMAC-signed `state` parameter, verified in the service.
 */
export const integrationsOAuthRoutes = Router();

function clientRedirect(res: Response, params: Record<string, string>) {
  const url = new URL('/integrations', env.CLIENT_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  res.redirect(302, url.toString());
}

integrationsOAuthRoutes.get('/:provider/callback', async (req: Request, res: Response) => {
  const provider = req.params.provider;
  const { code, state, error, error_description } = req.query as Record<string, string>;

  // User hit "Cancel" on the consent screen — not an error worth alarming over.
  if (error) {
    clientRedirect(res, { oauth: provider, status: 'cancelled', message: error_description || error });
    return;
  }
  if (!code || !state) {
    clientRedirect(res, { oauth: provider, status: 'error', message: 'Missing code or state' });
    return;
  }
  try {
    const result = await handleOAuthCallback(provider, code, state);
    if (result.needsSetup) {
      clientRedirect(res, { oauth: provider, status: 'setup', message: result.needsSetup });
    } else {
      clientRedirect(res, { oauth: provider, status: 'ok' });
    }
  } catch (err: any) {
    clientRedirect(res, { oauth: provider, status: 'error', message: (err?.message || 'Connection failed').slice(0, 200) });
  }
});

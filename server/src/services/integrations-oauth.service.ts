import crypto from 'crypto';
import { env } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import type { IntegrationProviderId, OAuthAvailability } from '@lemlist/shared';

/**
 * One-click OAuth connect for integrations.
 *
 * Flow: the client asks the authed API for an authorize URL (start), the
 * browser visits the provider's consent screen, and the provider redirects
 * back to the PUBLIC callback route with a code + our signed state. The
 * state is HMAC-bound to the user and expires, so the unauthenticated
 * callback can safely establish who the connection belongs to.
 *
 * Only providers whose app credentials are configured in env offer OAuth;
 * everything degrades gracefully to manual-credentials mode without them.
 */

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

interface OAuthProviderDef {
  id: IntegrationProviderId;
  clientId: () => string;
  clientSecret: () => string;
  /** Build the provider consent URL. */
  authorizeUrl(redirectUri: string, state: string): string;
  /**
   * Exchange the callback code for stored config. Returns the integration
   * config to persist plus whether the connection still needs a follow-up
   * step in the UI (e.g. picking a Notion database).
   */
  exchange(code: string, redirectUri: string): Promise<{
    config: Record<string, string>;
    needsSetup?: string; // human message when the connection isn't usable yet
  }>;
}

export function oauthRedirectUri(provider: string): string {
  return `${env.API_BASE_URL.replace(/\/+$/, '')}/api/oauth/integrations/${provider}/callback`;
}

// ── Signed state ─────────────────────────────────────────────────

function stateSecret(): string {
  // ENCRYPTION_KEY is guaranteed 64 hex chars by env validation.
  return env.ENCRYPTION_KEY;
}

export function signOAuthState(userId: string, provider: string): string {
  const payload = Buffer.from(
    JSON.stringify({ u: userId, p: provider, e: Date.now() + OAUTH_STATE_TTL_MS, n: crypto.randomBytes(8).toString('hex') })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', stateSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyOAuthState(state: string, provider: string): { userId: string } {
  const [payload, sig] = String(state || '').split('.');
  if (!payload || !sig) throw new AppError('Invalid OAuth state', 400);
  const expected = crypto.createHmac('sha256', stateSecret()).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new AppError('OAuth state signature mismatch', 400);
  }
  let parsed: { u: string; p: string; e: number };
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new AppError('Invalid OAuth state', 400);
  }
  if (parsed.p !== provider) throw new AppError('OAuth state is for a different provider', 400);
  if (!parsed.u || typeof parsed.e !== 'number' || Date.now() > parsed.e) {
    throw new AppError('OAuth state expired — start the connection again', 400);
  }
  return { userId: parsed.u };
}

// ── HTTP helper (providers here are fixed, trusted hosts) ────────

async function tokenRequest(
  url: string,
  body: URLSearchParams | string,
  headers: Record<string, string>
): Promise<{ status: number; json: any; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal, redirect: 'error' });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* some providers return html on errors */ }
    return { status: res.status, json, text };
  } catch (err: any) {
    throw new AppError(`Could not reach the provider: ${err?.name === 'AbortError' ? 'timed out' : err?.message || 'network error'}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

// ── Provider definitions ─────────────────────────────────────────

const slackOAuth: OAuthProviderDef = {
  id: 'slack',
  clientId: () => env.SLACK_CLIENT_ID,
  clientSecret: () => env.SLACK_CLIENT_SECRET,
  authorizeUrl(redirectUri, state) {
    const q = new URLSearchParams({
      client_id: this.clientId(),
      scope: 'incoming-webhook',
      redirect_uri: redirectUri,
      state,
    });
    return `https://slack.com/oauth/v2/authorize?${q}`;
  },
  async exchange(code, redirectUri) {
    const res = await tokenRequest(
      'https://slack.com/api/oauth.v2.access',
      new URLSearchParams({ client_id: this.clientId(), client_secret: this.clientSecret(), code, redirect_uri: redirectUri }),
      { 'Content-Type': 'application/x-www-form-urlencoded' }
    );
    if (!res.json?.ok || !res.json?.incoming_webhook?.url) {
      throw new AppError(`Slack rejected the connection: ${res.json?.error || res.text.slice(0, 120)}`, 400);
    }
    return {
      config: {
        webhook_url: res.json.incoming_webhook.url,
        auth_kind: 'oauth',
        channel: res.json.incoming_webhook.channel || '',
        workspace: res.json.team?.name || '',
      },
    };
  },
};

const discordOAuth: OAuthProviderDef = {
  id: 'discord',
  clientId: () => env.DISCORD_CLIENT_ID,
  clientSecret: () => env.DISCORD_CLIENT_SECRET,
  authorizeUrl(redirectUri, state) {
    const q = new URLSearchParams({
      client_id: this.clientId(),
      scope: 'webhook.incoming',
      response_type: 'code',
      redirect_uri: redirectUri,
      state,
    });
    return `https://discord.com/oauth2/authorize?${q}`;
  },
  async exchange(code, redirectUri) {
    const res = await tokenRequest(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: this.clientId(),
        client_secret: this.clientSecret(),
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
      { 'Content-Type': 'application/x-www-form-urlencoded' }
    );
    if (res.status !== 200 || !res.json?.webhook?.url) {
      throw new AppError(`Discord rejected the connection: ${res.json?.error_description || res.json?.error || res.text.slice(0, 120)}`, 400);
    }
    return {
      config: {
        webhook_url: res.json.webhook.url,
        auth_kind: 'oauth',
        channel: res.json.webhook.channel_id || '',
        guild: res.json.webhook.guild_id || '',
      },
    };
  },
};

const HUBSPOT_OAUTH_SCOPES = 'crm.objects.contacts.read crm.objects.contacts.write crm.objects.deals.read crm.objects.deals.write';

const hubspotOAuth: OAuthProviderDef = {
  id: 'hubspot',
  clientId: () => env.HUBSPOT_CLIENT_ID,
  clientSecret: () => env.HUBSPOT_CLIENT_SECRET,
  authorizeUrl(redirectUri, state) {
    const q = new URLSearchParams({
      client_id: this.clientId(),
      scope: HUBSPOT_OAUTH_SCOPES,
      redirect_uri: redirectUri,
      state,
    });
    return `https://app.hubspot.com/oauth/authorize?${q}`;
  },
  async exchange(code, redirectUri) {
    const res = await tokenRequest(
      'https://api.hubapi.com/oauth/v1/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.clientId(),
        client_secret: this.clientSecret(),
        redirect_uri: redirectUri,
        code,
      }),
      { 'Content-Type': 'application/x-www-form-urlencoded' }
    );
    if (res.status !== 200 || !res.json?.access_token) {
      throw new AppError(`HubSpot rejected the connection: ${res.json?.message || res.text.slice(0, 120)}`, 400);
    }
    return {
      config: {
        access_token: res.json.access_token,
        refresh_token: res.json.refresh_token || '',
        expires_at: String(Date.now() + (res.json.expires_in || 1800) * 1000),
        auth_kind: 'oauth',
        create_deals: 'yes',
      },
    };
  },
};

const notionOAuth: OAuthProviderDef = {
  id: 'notion',
  clientId: () => env.NOTION_CLIENT_ID,
  clientSecret: () => env.NOTION_CLIENT_SECRET,
  authorizeUrl(redirectUri, state) {
    const q = new URLSearchParams({
      client_id: this.clientId(),
      response_type: 'code',
      owner: 'user',
      redirect_uri: redirectUri,
      state,
    });
    return `https://api.notion.com/v1/oauth/authorize?${q}`;
  },
  async exchange(code, redirectUri) {
    const basic = Buffer.from(`${this.clientId()}:${this.clientSecret()}`).toString('base64');
    const res = await tokenRequest(
      'https://api.notion.com/v1/oauth/token',
      JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
      { 'Content-Type': 'application/json', Authorization: `Basic ${basic}` }
    );
    if (res.status !== 200 || !res.json?.access_token) {
      throw new AppError(`Notion rejected the connection: ${res.json?.error_description || res.json?.error || res.text.slice(0, 120)}`, 400);
    }
    return {
      config: {
        token: res.json.access_token,
        auth_kind: 'oauth',
        workspace: res.json.workspace_name || '',
      },
      // A database still has to be chosen — the client opens the picker.
      needsSetup: 'Choose a database to finish connecting',
    };
  },
};

const OAUTH_PROVIDERS: Partial<Record<IntegrationProviderId, OAuthProviderDef>> = {
  slack: slackOAuth,
  discord: discordOAuth,
  hubspot: hubspotOAuth,
  notion: notionOAuth,
};

// ── Public API ───────────────────────────────────────────────────

export function oauthAvailability(): OAuthAvailability {
  const out: OAuthAvailability = {};
  for (const [id, def] of Object.entries(OAUTH_PROVIDERS)) {
    out[id as IntegrationProviderId] = !!(def!.clientId() && def!.clientSecret());
  }
  return out;
}

export function getAuthorizeUrl(userId: string, provider: string): string {
  const def = OAUTH_PROVIDERS[provider as IntegrationProviderId];
  if (!def) throw new AppError('This provider does not support one-click connect', 404);
  if (!def.clientId() || !def.clientSecret()) {
    throw new AppError('One-click connect is not configured for this provider — use manual setup', 400);
  }
  return def.authorizeUrl(oauthRedirectUri(provider), signOAuthState(userId, provider));
}

/**
 * Handle the provider redirect: verify state, exchange the code, and upsert
 * the integration. Returns what the client redirect needs to say.
 */
export async function handleOAuthCallback(
  provider: string,
  code: string,
  state: string
): Promise<{ userId: string; needsSetup?: string }> {
  const def = OAUTH_PROVIDERS[provider as IntegrationProviderId];
  if (!def) throw new AppError('Unknown OAuth provider', 404);
  const { userId } = verifyOAuthState(state, provider);
  const { config, needsSetup } = await def.exchange(code, oauthRedirectUri(provider));

  // Preserve any keys the user already had that OAuth doesn't supply
  // (e.g. Notion database_id from a previous manual setup, deal toggles).
  const { data: existing } = await supabaseAdmin
    .from('user_integrations')
    .select('config, events')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle();
  const mergedConfig = { ...(existing?.config || {}), ...config };

  const stillNeedsSetup = needsSetup && !(provider === 'notion' && mergedConfig.database_id) ? needsSetup : undefined;

  const now = new Date().toISOString();
  const { error } = await supabaseAdmin.from('user_integrations').upsert(
    {
      user_id: userId,
      provider,
      config: mergedConfig,
      // Keep prior event selection; otherwise defaults are applied on the
      // finishing "save" from the client (sanitizeEvents handles empty).
      events: existing?.events?.length ? existing.events : [],
      is_active: !stillNeedsSetup,
      last_success_at: stillNeedsSetup ? null : now,
      last_error: stillNeedsSetup || null,
      updated_at: now,
    },
    { onConflict: 'user_id,provider' }
  );
  if (error) throw error;
  return { userId, needsSetup: stillNeedsSetup };
}

/**
 * HubSpot OAuth access tokens live ~30 minutes. Called before any HubSpot
 * API use: refreshes when close to expiry and persists the new tokens.
 * Returns the config to use (possibly updated). No-op for private-app
 * tokens (no refresh_token stored).
 */
export async function ensureFreshHubspotToken(
  integrationId: string,
  config: Record<string, string>
): Promise<Record<string, string>> {
  if (config.auth_kind !== 'oauth' || !config.refresh_token) return config;
  const expiresAt = Number(config.expires_at || 0);
  if (expiresAt && Date.now() < expiresAt - 120_000) return config;

  const res = await tokenRequest(
    'https://api.hubapi.com/oauth/v1/token',
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: env.HUBSPOT_CLIENT_ID,
      client_secret: env.HUBSPOT_CLIENT_SECRET,
      refresh_token: config.refresh_token,
    }),
    { 'Content-Type': 'application/x-www-form-urlencoded' }
  );
  if (res.status !== 200 || !res.json?.access_token) {
    throw new Error(`HubSpot token refresh failed (${res.status}): ${res.json?.message || res.text.slice(0, 120)}`);
  }
  const updated = {
    ...config,
    access_token: res.json.access_token,
    refresh_token: res.json.refresh_token || config.refresh_token,
    expires_at: String(Date.now() + (res.json.expires_in || 1800) * 1000),
  };
  const { error } = await supabaseAdmin
    .from('user_integrations')
    .update({ config: updated, updated_at: new Date().toISOString() })
    .eq('id', integrationId);
  if (error) console.error('[Integrations] Failed to persist refreshed HubSpot token:', error.message);
  return updated;
}

import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('3001'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_JWT_SECRET: z.string().optional().default(''),
  REDIS_URL: z.string().optional().default(''),
  API_BASE_URL: z.string().default('http://localhost:3001'),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  TRACKING_BASE_URL: z.string().default('http://localhost:3001'),
  TRACKING_SECRET: z.string().min(16),
  ENCRYPTION_KEY: z.string().length(64).regex(/^[0-9a-f]{64}$/i, 'must be 64 hex characters'),
  // Accepts either the full endpoint or just the deployment origin — a bare
  // "https://app.vercel.app" is the single most common way this gets set, and
  // silently posting to the site root looks identical to a broken relay.
  SMTP_RELAY_URL: z.string().optional().default('').transform((raw) => {
    const url = (raw || '').trim().replace(/\/+$/, '');
    if (!url) return '';
    return /\/api\//.test(url) ? url : `${url}/api/send-email`;
  }),
  SMTP_RELAY_SECRET: z.string().optional().default(''),
  STRIPE_SECRET_KEY: z.string().optional().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(''),
  // Prospector data providers - set one key to switch the built-in
  // prospect search on. Icypeas is preferred, then PDL. Apollo only runs
  // when ALLOW_APOLLO_PROVIDER=true as well: its API terms forbid use in a
  // competing product, so it is for internal testing, never for customers.
  ICYPEAS_API_KEY: z.string().optional().default(''),
  PDL_API_KEY: z.string().optional().default(''),
  // What one Icypeas credit costs us, for the admin profit page ($19 per 1,000).
  ICYPEAS_USD_PER_CREDIT: z.string().optional().default('0.019').transform((v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0.019;
  }),
  // The email of our Icypeas account: their balance route asks for it.
  ICYPEAS_ACCOUNT_EMAIL: z.string().optional().default(''),
  // Below this many Icypeas credits the admin page warns.
  ICYPEAS_LOW_BALANCE: z.string().optional().default('250').transform((v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 250;
  }),
  APOLLO_API_KEY: z.string().optional().default(''),
  ALLOW_APOLLO_PROVIDER: z.string().optional().default('').transform((v) => /^(1|true|yes)$/i.test(v.trim())),
  // One-click OAuth for integrations — set a provider's client id + secret
  // to switch its "Connect with …" button on. Absent = manual-credentials
  // mode only (which always works). Redirect URIs are built from
  // API_BASE_URL: <API_BASE_URL>/api/oauth/integrations/<provider>/callback
  SLACK_CLIENT_ID: z.string().optional().default(''),
  SLACK_CLIENT_SECRET: z.string().optional().default(''),
  DISCORD_CLIENT_ID: z.string().optional().default(''),
  DISCORD_CLIENT_SECRET: z.string().optional().default(''),
  HUBSPOT_CLIENT_ID: z.string().optional().default(''),
  HUBSPOT_CLIENT_SECRET: z.string().optional().default(''),
  NOTION_CLIENT_ID: z.string().optional().default(''),
  NOTION_CLIENT_SECRET: z.string().optional().default(''),
  // Google Calendar, for reading free/busy so a booking page never offers a
  // time the account is already busy in a calendar Sincerely does not own.
  // Redirect URI: <API_BASE_URL>/api/oauth/calendar/google/callback
  // Absent = the feature is simply off; everything else works unchanged.
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  // Relay reads replies, drafts answers and writes sequences with Claude
  // when this is set. Absent = the keyword rules and built-in templates,
  // which always work.
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  RELAY_MODEL: z.string().optional().default('claude-opus-5-5'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

/**
 * Public URLs still on their localhost defaults, in production.
 *
 * Every one of these ends up in mail or a redirect that leaves this server,
 * so a default here does not fail - it quietly ships links nobody can open.
 * Production is NODE_ENV, or the host platforms' own markers (Render and
 * Railway do not set NODE_ENV for you).
 */
export function localhostUrlProblems(): Array<{ name: string; value: string; breaks: string }> {
  const production = process.env.NODE_ENV === 'production' || !!process.env.RENDER || !!process.env.RAILWAY_ENVIRONMENT;
  if (!production) return [];
  const local = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(url.trim());
  const checks: Array<{ name: 'TRACKING_BASE_URL' | 'CLIENT_URL' | 'API_BASE_URL'; breaks: string }> = [
    { name: 'TRACKING_BASE_URL', breaks: 'the open-tracking pixel, click-tracked links and unsubscribe links in sent mail point at localhost (for accounts without their own tracking domain)' },
    { name: 'CLIENT_URL', breaks: 'booking links, links in notifications and digests, billing return pages and post-OAuth redirects point at localhost' },
    { name: 'API_BASE_URL', breaks: 'OAuth callback URLs (integrations, Google Calendar) and inbound webhook URLs point at localhost' },
  ];
  return checks
    .filter((c) => local(env[c.name]))
    .map((c) => ({ name: c.name, value: env[c.name], breaks: c.breaks }));
}

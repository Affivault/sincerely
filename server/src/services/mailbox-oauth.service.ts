/* ═══════════════════════════════════════════════════════════════════════
   Outlook and Microsoft 365 mailboxes, connected with Microsoft sign-in
   (migration 114).

   Microsoft has switched off password and app-password sign-in for
   Outlook.com, Hotmail and Live, and is retiring it for Microsoft 365. So
   "Connect with Microsoft" signs the mailbox in once, and the server keeps
   a renewal token; every send, inbox sync, reply check and warm-up then
   signs in to SMTP and IMAP with a fresh access token (XOAUTH2) instead of
   a password.

   How it slots in without touching every caller:

   - A Microsoft mailbox's smtp_pass_encrypted holds, encrypted, the marker
     "msoauth:<account id>" rather than a password.
   - Wherever a password was decrypted, mailboxSecret() is used instead. For
     a password mailbox it returns the password, exactly as before; for a
     Microsoft one it returns "oauth2:<access token>", renewed when due.
   - The places that open connections (nodemailer, ImapFlow, the relay)
     pass the secret through smtpAuth() / imapAuth(), which turn an
     "oauth2:" secret into a token sign-in and anything else into a
     password sign-in.

   Scopes are the least that work: send mail (SMTP.Send), read the inbox
   (IMAP.AccessAsUser.All), stay signed in (offline_access), and who it is
   (openid, email, profile). Nothing in OneDrive, the calendar or contacts.
   ═══════════════════════════════════════════════════════════════════════ */

import crypto from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { encrypt, decrypt } from '../utils/encryption.js';
import { env } from '../config/env.js';
import { newOAuthNonce, signState, verifyState } from './calendar-sync.service.js';
import { RECOMMENDED_DAILY_LIMIT } from '@lemlist/shared';

const MS_AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MS_TOKEN = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
export const MS_MAIL_SCOPES = 'openid email profile offline_access https://outlook.office.com/SMTP.Send https://outlook.office.com/IMAP.AccessAsUser.All';
/** Microsoft's tenant for personal accounts (Outlook.com, Hotmail, Live). */
const CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

export const MAILBOX_OAUTH_COOKIE_PATH = '/api/oauth/mailbox';
const MARKER = 'msoauth:';
const TOKEN = 'oauth2:';

export function microsoftMailConfigured(): boolean {
  return !!(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET);
}

export function mailboxRedirectUri(): string {
  return `${env.API_BASE_URL.replace(/\/+$/, '')}/api/oauth/mailbox/microsoft/callback`;
}

/* ── Turning a stored secret into a sign-in ──────────────────────────── */

/** For nodemailer: a token sign-in for "oauth2:" secrets, a password otherwise. */
export function smtpAuth(user: string, secret: string | null | undefined): any {
  const s = String(secret || '');
  if (s.startsWith(TOKEN)) return { type: 'OAuth2', user, accessToken: s.slice(TOKEN.length) };
  return { user, pass: s };
}

/** For ImapFlow: a token sign-in for "oauth2:" secrets, a password otherwise. */
export function imapAuth(user: string, secret: string | null | undefined): any {
  const s = String(secret || '');
  if (s.startsWith(TOKEN)) return { user, accessToken: s.slice(TOKEN.length) };
  return { user, pass: s };
}

export function isTokenSecret(secret: string | null | undefined): boolean {
  return String(secret || '').startsWith(TOKEN);
}

/** What smtp_pass_encrypted holds for a Microsoft mailbox. */
export function microsoftMarker(accountId: string): string {
  return encrypt(`${MARKER}${accountId}`);
}

/**
 * The secret to sign a mailbox in with: its password, or for a Microsoft
 * mailbox "oauth2:<fresh access token>". Throws (like decrypt did) when it
 * cannot be had, with a message that says what to do.
 */
export async function mailboxSecret(encrypted: string | null | undefined): Promise<string> {
  const plain = decrypt(String(encrypted || ''));
  if (!plain.startsWith(MARKER)) return plain;
  const token = await microsoftAccessToken(plain.slice(MARKER.length));
  return `${TOKEN}${token}`;
}

/* ── Tokens ──────────────────────────────────────────────────────────── */

class MicrosoftSignInError extends Error {
  constructor(message: string, public permanent = false) { super(message); }
}

async function tokenPost(body: URLSearchParams): Promise<any> {
  const res = await fetch(MS_TOKEN, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    redirect: 'error', signal: AbortSignal.timeout(20_000),
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    const code = String(json?.error || 'error');
    const desc = String(json?.error_description || `Microsoft answered ${res.status}`).split('\r\n')[0];
    throw new MicrosoftSignInError(`${code}: ${desc}`, /invalid_grant|interaction_required|consent_required|unauthorized_client|invalid_client/i.test(code));
  }
  return json;
}

/** The claims in Microsoft's id_token. Read, not verified: it came straight
 *  from Microsoft's token endpoint over TLS, in answer to our own request. */
function idClaims(idToken: string | undefined): Record<string, any> {
  try {
    return JSON.parse(Buffer.from(String(idToken || '').split('.')[1] || '', 'base64url').toString('utf8')) || {};
  } catch {
    return {};
  }
}

const cache = new Map<string, { token: string; until: number }>();
const inflight = new Map<string, Promise<string>>();

async function microsoftAccessToken(accountId: string, opts: { force?: boolean } = {}): Promise<string> {
  const hit = cache.get(accountId);
  if (!opts.force && hit && hit.until > Date.now()) return hit.token;
  const running = inflight.get(accountId);
  if (running) return running;
  const p = (async () => {
    const { data: row, error } = await supabaseAdmin.from('mailbox_oauth').select('*').eq('account_id', accountId).maybeSingle();
    if (error || !row) throw new Error('This mailbox\'s Microsoft sign-in is missing. Reconnect it with "Connect with Microsoft".');
    if (row.broken_at) throw new Error(row.broken_reason || 'Microsoft sign-in stopped working. Reconnect this mailbox.');
    if (!opts.force && row.access_token && row.expires_at && new Date(row.expires_at).getTime() > Date.now() + 60_000) {
      const token = decrypt(row.access_token);
      cache.set(accountId, { token, until: new Date(row.expires_at).getTime() - 60_000 });
      return token;
    }
    try {
      const t = await tokenPost(new URLSearchParams({
        client_id: env.MICROSOFT_CLIENT_ID, client_secret: env.MICROSOFT_CLIENT_SECRET,
        refresh_token: decrypt(row.refresh_token), grant_type: 'refresh_token', scope: MS_MAIL_SCOPES,
      }));
      const expiresAt = new Date(Date.now() + ((Number(t.expires_in) || 3600) - 120) * 1000);
      const patch: Record<string, any> = { access_token: encrypt(t.access_token), expires_at: expiresAt.toISOString() };
      // Microsoft rotates refresh tokens; keep the newest or the old one dies.
      if (t.refresh_token) patch.refresh_token = encrypt(t.refresh_token);
      await supabaseAdmin.from('mailbox_oauth').update(patch).eq('account_id', accountId);
      cache.set(accountId, { token: t.access_token, until: expiresAt.getTime() - 60_000 });
      return t.access_token as string;
    } catch (err: any) {
      if (err instanceof MicrosoftSignInError && err.permanent) {
        const reason = 'Microsoft sign-in for this mailbox was revoked or expired. Reconnect it with "Connect with Microsoft".';
        await supabaseAdmin.from('mailbox_oauth').update({ broken_at: new Date().toISOString(), broken_reason: reason }).eq('account_id', accountId);
        // Out of rotation until reconnected, so no campaign step fails on it;
        // the watchdog tells the owner (system-status, "Reconnect ... with Microsoft").
        await supabaseAdmin.from('smtp_accounts').update({ last_send_error: reason, is_verified: false }).eq('id', accountId);
        cache.delete(accountId);
        throw new Error(reason);
      }
      throw new Error(`Could not renew the Microsoft sign-in: ${err?.message || err}`);
    }
  })();
  inflight.set(accountId, p);
  try { return await p; } finally { inflight.delete(accountId); }
}

/* ── Connecting ──────────────────────────────────────────────────────── */

export const mailboxOAuthService = {
  authorizeUrl(userId: string, opts: { loginHint?: string } = {}): { url: string; nonce: string } {
    if (!microsoftMailConfigured()) throw new AppError('Connecting with Microsoft is not set up on this deployment yet.', 503);
    const nonce = newOAuthNonce();
    const q = new URLSearchParams({
      client_id: env.MICROSOFT_CLIENT_ID,
      response_type: 'code',
      redirect_uri: mailboxRedirectUri(),
      response_mode: 'query',
      scope: MS_MAIL_SCOPES,
      state: signState(userId, nonce, 'mailbox_microsoft'),
      prompt: 'select_account',
    });
    if (opts.loginHint && /^[^\s@]+@[^\s@]+$/.test(opts.loginHint)) q.set('login_hint', opts.loginHint);
    return { url: `${MS_AUTH}?${q}`, nonce };
  },

  /**
   * From the callback: save the sign-in and the mailbox, then prove it can
   * send and read. A mailbox already here under the same address is moved
   * onto Microsoft sign-in (keeping its history, limits and warm-up) rather
   * than added twice.
   */
  async completeConnection(code: string, state: string, browserNonce: string | undefined) {
    if (!browserNonce) throw new AppError('Start connecting again from this browser.', 400);
    const { userId, purpose } = verifyState(state, browserNonce);
    if (purpose !== 'mailbox_microsoft') throw new AppError('Start connecting again.', 400);

    const t = await tokenPost(new URLSearchParams({
      client_id: env.MICROSOFT_CLIENT_ID, client_secret: env.MICROSOFT_CLIENT_SECRET, code,
      redirect_uri: mailboxRedirectUri(), grant_type: 'authorization_code', scope: MS_MAIL_SCOPES,
    })).catch((e: any) => { throw new AppError(String(e?.message || 'Microsoft did not finish signing in'), 400); });
    if (!t.refresh_token) throw new AppError('Microsoft did not allow Sincerely to stay signed in. Connect again and accept every permission.', 400);
    const granted = String(t.scope || '');
    if (!/SMTP\.Send/i.test(granted)) throw new AppError('Microsoft did not give permission to send. Connect again and accept every permission.', 400);

    const claims = idClaims(t.id_token);
    const email = String(claims.email || claims.preferred_username || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError('Microsoft did not say which mailbox this is. Try again.', 400);
    const personal = claims.tid === CONSUMER_TENANT;
    const name = String(claims.name || '').trim() || null;

    const connection = {
      smtp_host: personal ? 'smtp-mail.outlook.com' : 'smtp.office365.com',
      smtp_port: 587, smtp_secure: false, smtp_user: email,
      imap_host: 'outlook.office365.com', imap_port: 993, imap_secure: true, imap_user: email,
    };

    const { data: mine, error: mineErr } = await supabaseAdmin.from('smtp_accounts').select('id, email_address, from_name').eq('user_id', userId);
    if (mineErr) throw new AppError(mineErr.message, 500);
    const existing = (mine || []).find((r: any) => String(r.email_address || '').trim().toLowerCase() === email);

    let accountId: string;
    let created = false;
    if (existing) {
      accountId = existing.id;
    } else {
      // Same rules as any new mailbox: the plan's mailbox cap first.
      const { billingService } = await import('./billing.service.js');
      await billingService.assertCanAddInbox(userId);
      accountId = crypto.randomUUID();
      created = true;
    }

    const now = new Date();
    const row: Record<string, any> = {
      ...connection,
      smtp_pass_encrypted: microsoftMarker(accountId),
      auth_kind: 'microsoft',
      last_send_error: null,
      last_inbox_sync_error: null,
    };
    if (created) {
      // A new mailbox starts at the pace recommended for cold email, not the
      // database's 200 a day: a fresh Outlook address sending 200 cold emails
      // on day one is how it gets blocked.
      Object.assign(row, {
        id: accountId, user_id: userId, email_address: email, from_name: name, label: email, is_active: true,
        daily_send_limit: RECOMMENDED_DAILY_LIMIT,
      });
      const { error } = await supabaseAdmin.from('smtp_accounts').insert(row);
      if (error) {
        if (/auth_kind/.test(error.message)) throw new AppError('Connecting with Microsoft needs the latest database update (migration 114).', 503);
        throw new AppError(error.message, 500);
      }
    } else {
      if (!existing?.from_name && name) row.from_name = name;
      const { error } = await supabaseAdmin.from('smtp_accounts').update(row).eq('id', accountId).eq('user_id', userId);
      if (error) {
        if (/auth_kind/.test(error.message)) throw new AppError('Connecting with Microsoft needs the latest database update (migration 114).', 503);
        throw new AppError(error.message, 500);
      }
    }

    const expiresAt = new Date(now.getTime() + ((Number(t.expires_in) || 3600) - 120) * 1000);
    const { error: oErr } = await supabaseAdmin.from('mailbox_oauth').upsert({
      account_id: accountId, user_id: userId, provider: 'microsoft', account_email: email, tenant_id: claims.tid || null,
      access_token: encrypt(t.access_token), refresh_token: encrypt(t.refresh_token), expires_at: expiresAt.toISOString(),
      broken_at: null, broken_reason: null,
    }, { onConflict: 'account_id' });
    if (oErr) throw new AppError(oErr.message, 500);
    cache.set(accountId, { token: t.access_token, until: expiresAt.getTime() - 60_000 });

    // Prove it: send a check to itself and sign in to the inbox.
    const { smtpService } = await import('./smtp.service.js');
    let check: { success: boolean; message?: string } = { success: false };
    try {
      check = await smtpService.verifyCredentials(userId, { ...connection, email_address: email, from_name: name, account_id: accountId });
    } catch (err: any) {
      check = { success: false, message: err?.message };
    }
    await supabaseAdmin.from('smtp_accounts').update(
      check.success ? { is_verified: true } : { is_verified: false, last_send_error: check.message || null },
    ).eq('id', accountId);
    return { email, accountId, created, verified: check.success, message: check.message || null, personal };
  },

  /**
   * The daily sign-in check. Renewing each Microsoft mailbox's sign-in proves
   * it still works (and keeps it alive: Microsoft drops sign-ins unused for
   * 90 days). One that was revoked is marked, taken out of rotation, and the
   * watchdog emails its owner - before a campaign trips over it, not after.
   * Cross-tenant: for the scheduler only.
   */
  async checkAll(): Promise<{ checked: number; broken: number }> {
    if (!microsoftMailConfigured()) return { checked: 0, broken: 0 };
    const since = new Date(Date.now() - 20 * 3600_000).toISOString();
    const { data, error } = await supabaseAdmin.from('mailbox_oauth').select('account_id')
      .is('broken_at', null).lt('updated_at', since).order('updated_at').limit(200);
    if (error) return { checked: 0, broken: 0 };
    let checked = 0;
    let broken = 0;
    for (const r of data || []) {
      try {
        await microsoftAccessToken(r.account_id, { force: true });
        checked++;
      } catch (err: any) {
        checked++;
        if (/revoked or expired/.test(String(err?.message))) broken++;
      }
    }
    return { checked, broken };
  },

  /**
   * The link an IT admin opens to approve Sincerely for their whole
   * organisation, so every mailbox there connects without "Need admin
   * approval". Sent to someone else, in another browser, so it carries no
   * per-browser state: the callback only says thank you.
   */
  adminConsentUrl(): string {
    if (!microsoftMailConfigured()) throw new AppError('Connecting with Microsoft is not set up on this deployment yet.', 503);
    const q = new URLSearchParams({
      client_id: env.MICROSOFT_CLIENT_ID,
      scope: MS_MAIL_SCOPES.split(' ').filter((s) => s !== 'offline_access').join(' '),
      redirect_uri: mailboxRedirectUri(),
      state: 'admin-consent',
    });
    return `https://login.microsoftonline.com/organizations/v2.0/adminconsent?${q}`;
  },

  /** For the mailbox list: which Microsoft mailboxes need reconnecting. */
  async states(userId: string): Promise<Record<string, { broken_reason: string | null; account_email: string | null }>> {
    const { data, error } = await supabaseAdmin.from('mailbox_oauth').select('account_id, account_email, broken_reason').eq('user_id', userId);
    if (error) return {};
    return Object.fromEntries((data || []).map((r: any) => [r.account_id, { broken_reason: r.broken_reason, account_email: r.account_email }]));
  },
};

/**
 * Microsoft's answer when the mailbox or the organisation has SMTP sign-in
 * switched off, in words that say who can fix it and where.
 */
export function describeMicrosoftSmtpError(raw: string): string | null {
  const s = raw.toLowerCase();
  if (s.includes('5.7.139') || s.includes('smtpclientauthentication is disabled') || s.includes('smtp auth is disabled')) {
    return 'Microsoft 365 has "Authenticated SMTP" switched off for this mailbox. An admin turns it on in the Microsoft 365 admin centre: '
      + 'Users > Active users > this user > Mail > Manage email apps > tick "Authenticated SMTP" > Save. It can take up to an hour to apply.';
  }
  if (s.includes('5.7.57') || s.includes('client was not authenticated to send anonymous mail')) {
    return 'Microsoft did not accept the sign-in for sending. Reconnect the mailbox with "Connect with Microsoft".';
  }
  if (s.includes('5.7.3') && s.includes('authentication unsuccessful')) {
    return 'Microsoft refused the sign-in. If this is a work account, an admin may need to allow Authenticated SMTP for it '
      + '(Microsoft 365 admin centre > Users > Active users > the user > Mail > Manage email apps). Otherwise, reconnect it.';
  }
  return null;
}

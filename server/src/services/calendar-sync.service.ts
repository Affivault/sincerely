import crypto from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { encrypt, decrypt } from '../utils/encryption.js';
import { env } from '../config/env.js';
import type { BusyInterval } from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   The calendars this account keeps somewhere else.

   Everything before this reasoned about the diary Sincerely can see. A
   meeting somebody put in Google an hour ago was invisible to it, so a
   booking page would cheerfully offer a time that was already gone - and
   that is the one failure here that costs a real person a real half hour.

   Three decisions run through this file.

   Only free/busy is read. Not titles, not attendees, not notes. The
   question a booking page asks is "is this half hour taken", and asking for
   anything more would be collecting somebody's private diary to answer a
   yes/no. The narrower scope is also the one a security review waves
   through.

   An outage degrades to stale, never to open. If Google cannot be reached
   when a visitor loads the page, the last good answer is used instead. The
   alternative - assume free - is exactly the double-booking this exists to
   prevent, and "no times available" would break the page over somebody
   else's outage.

   A dead token is reported, not swallowed. Access gets revoked, passwords
   change, apps get deleted. When that happens the connection is marked
   broken so the UI can say so, because a booking page quietly running
   without the calendar it was told to consult is worse than one that never
   had it.
   ═══════════════════════════════════════════════════════════════════════ */

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_FREEBUSY = 'https://www.googleapis.com/calendar/v3/freeBusy';
const GOOGLE_USERINFO = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GOOGLE_EVENTS = 'https://www.googleapis.com/calendar/v3/calendars';

/**
 * The narrowest scopes that do the job.
 *
 * calendar.freebusy answers "is this taken" without exposing a single
 * event's contents. calendar.events is needed only to WRITE bookings back,
 * and is requested because a scheduler that cannot put the meeting in your
 * real calendar is doing half a job - but the read path never uses it.
 */
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

const STATE_TTL_MS = 10 * 60 * 1000;

/** Live only when the app's credentials are configured. */
export function googleConfigured(): boolean {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function googleRedirectUri(): string {
  return `${env.API_BASE_URL.replace(/\/+$/, '')}/api/oauth/calendar/google/callback`;
}

/* ── Signed state, the same construction the integrations OAuth uses ── */

export function signState(userId: string): string {
  const payload = Buffer.from(JSON.stringify({
    u: userId, e: Date.now() + STATE_TTL_MS, n: crypto.randomBytes(8).toString('hex'),
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', env.ENCRYPTION_KEY).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyState(state: string): { userId: string } {
  const [payload, sig] = String(state || '').split('.');
  if (!payload || !sig) throw new AppError('Invalid state', 400);
  const expected = crypto.createHmac('sha256', env.ENCRYPTION_KEY).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  // Length first: timingSafeEqual throws rather than returning false.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new AppError('State signature mismatch', 400);
  }
  let parsed: { u: string; e: number };
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new AppError('Invalid state', 400);
  }
  if (!parsed.u || Date.now() > parsed.e) {
    throw new AppError('That took too long - start connecting again.', 400);
  }
  return { userId: parsed.u };
}

/* ── HTTP, against fixed trusted hosts ── */

async function post(url: string, body: URLSearchParams): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
      redirect: 'error',
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* non-JSON error page */ }
    if (!res.ok) {
      throw new AppError(json?.error_description || json?.error || `Google said ${res.status}`, 502);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function authed(url: string, token: string, init?: RequestInit): Promise<{ ok: boolean; status: number; json: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      redirect: 'error',
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

/* ── Connecting ── */

export const calendarSync = {
  authorizeUrl(userId: string): string {
    if (!googleConfigured()) {
      throw new AppError('Google Calendar is not set up on this deployment yet.', 503);
    }
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: googleRedirectUri(),
      response_type: 'code',
      scope: SCOPES,
      // offline + consent, together, because Google returns a refresh token
      // only on the FIRST consent for an app-account pair. Without forcing
      // consent, a reconnect silently yields no refresh token and the
      // connection dies an hour later with nothing in the logs to say why.
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state: signState(userId),
    });
    return `${GOOGLE_AUTH}?${params.toString()}`;
  },

  /** Exchange the callback code and store the connection. */
  async completeConnection(code: string, state: string): Promise<{ email: string }> {
    const { userId } = verifyState(state);

    const token = await post(GOOGLE_TOKEN, new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: googleRedirectUri(),
      grant_type: 'authorization_code',
    }));

    const who = await authed(GOOGLE_USERINFO, token.access_token);
    const email = who.json?.email || null;

    const expiresAt = new Date(Date.now() + ((token.expires_in || 3600) - 60) * 1000);

    /*
     * Upsert on (user, provider, account) so reconnecting the same Google
     * account updates rather than accumulating duplicates that would each
     * be consulted on every page load.
     *
     * The refresh token is only overwritten when Google sent one. A
     * reconnect that omits it must not blank the one already stored, or the
     * connection stops being able to refresh and dies silently.
     */
    const patch: Record<string, any> = {
      user_id: userId,
      provider: 'google',
      account_email: email,
      access_token: encrypt(token.access_token),
      expires_at: expiresAt.toISOString(),
      broken_at: null,
      broken_reason: null,
      last_synced_at: new Date().toISOString(),
    };
    if (token.refresh_token) patch.refresh_token = encrypt(token.refresh_token);

    const { error } = await supabaseAdmin
      .from('calendar_connections')
      .upsert(patch, { onConflict: 'user_id,provider,account_email' });
    if (error) throw new AppError(error.message, 500);

    return { email: email || 'your Google account' };
  },

  /** What the account sees. Never a token. */
  async list(userId: string) {
    const { data, error } = await supabaseAdmin
      .from('calendar_connections')
      .select('id, provider, account_email, read_busy, write_events, broken_at, broken_reason, last_synced_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error) throw new AppError(error.message, 500);
    return data || [];
  },

  async update(userId: string, id: string, input: { read_busy?: boolean; write_events?: boolean }) {
    const patch: Record<string, any> = {};
    if (input.read_busy !== undefined) patch.read_busy = !!input.read_busy;
    if (input.write_events !== undefined) patch.write_events = !!input.write_events;
    if (Object.keys(patch).length === 0) return { updated: false };

    const { data, error } = await supabaseAdmin
      .from('calendar_connections')
      .update(patch)
      .eq('user_id', userId)
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('No such connection.', 404);
    return { updated: true };
  },

  async disconnect(userId: string, id: string) {
    const { data, error } = await supabaseAdmin
      .from('calendar_connections')
      .delete()
      .eq('user_id', userId)
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('No such connection.', 404);
    return { disconnected: true };
  },

  /**
   * A usable access token, refreshing if the stored one has expired.
   *
   * Returns null when the connection cannot be revived, having marked it
   * broken - the caller then decides what to do without a token, which is
   * never "assume the calendar is empty".
   */
  async accessTokenFor(connection: any): Promise<string | null> {
    try {
      if (connection.expires_at && new Date(connection.expires_at) > new Date()) {
        return decrypt(connection.access_token);
      }
      if (!connection.refresh_token) {
        await this.markBroken(connection.id, 'Reconnect needed - no refresh token was stored.');
        return null;
      }

      const refreshed = await post(GOOGLE_TOKEN, new URLSearchParams({
        refresh_token: decrypt(connection.refresh_token),
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        grant_type: 'refresh_token',
      }));

      const expiresAt = new Date(Date.now() + ((refreshed.expires_in || 3600) - 60) * 1000);
      await supabaseAdmin.from('calendar_connections').update({
        access_token: encrypt(refreshed.access_token),
        expires_at: expiresAt.toISOString(),
        broken_at: null,
        broken_reason: null,
      }).eq('id', connection.id);

      return refreshed.access_token;
    } catch (err: any) {
      /*
       * A refresh that fails with invalid_grant is permanent: access was
       * revoked, or the token was not used for six months. Anything else
       * may be transient, so it is reported but not marked broken - a
       * fifteen second Google outage must not send somebody through the
       * consent screen again.
       */
      const message = String(err?.message || err);
      if (/invalid_grant|unauthorized|invalid_client/i.test(message)) {
        await this.markBroken(connection.id, 'Access was revoked. Reconnect to fix it.');
      } else {
        console.error(`[CalendarSync] Token refresh failed: ${message}`);
      }
      return null;
    }
  },

  async markBroken(id: string, reason: string) {
    await supabaseAdmin.from('calendar_connections').update({
      broken_at: new Date().toISOString(),
      broken_reason: reason.slice(0, 200),
    }).eq('id', id);
  },

  /**
   * Everything the account's external calendars say is taken.
   *
   * The whole point of the feature, and the one call a booking page makes
   * into it. Never throws: a page that cannot render because Google is slow
   * is a page that books nobody.
   */
  async externalBusy(userId: string, from: Date, to: Date): Promise<BusyInterval[]> {
    if (!googleConfigured()) return [];

    const { data: connections } = await supabaseAdmin
      .from('calendar_connections')
      .select('id, provider, access_token, refresh_token, expires_at, calendar_ids, read_busy')
      .eq('user_id', userId)
      .eq('read_busy', true);

    if (!connections || connections.length === 0) return [];

    const out: BusyInterval[] = [];
    for (const connection of connections) {
      try {
        const live = await this.fetchBusy(connection, from, to);
        if (live) {
          out.push(...live);
          continue;
        }
        // Unreachable or unauthorised: fall back to what it last said
        // rather than to nothing, which would read as "free".
        out.push(...await this.cachedBusy(connection.id, from, to));
      } catch (err: any) {
        console.error(`[CalendarSync] ${connection.id} busy lookup failed: ${err?.message || err}`);
        out.push(...await this.cachedBusy(connection.id, from, to));
      }
    }
    return out;
  },

  /** Live free/busy, or null when it could not be had. */
  async fetchBusy(connection: any, from: Date, to: Date): Promise<BusyInterval[] | null> {
    const token = await this.accessTokenFor(connection);
    if (!token) return null;

    const items = (connection.calendar_ids?.length ? connection.calendar_ids : ['primary'])
      .map((id: string) => ({ id }));

    const res = await authed(GOOGLE_FREEBUSY, token, {
      method: 'POST',
      body: JSON.stringify({
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        items,
      }),
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        await this.markBroken(connection.id, 'Google refused the request. Reconnect to fix it.');
      }
      return null;
    }

    const intervals: BusyInterval[] = [];
    for (const cal of Object.values<any>(res.json?.calendars || {})) {
      for (const slot of cal?.busy || []) {
        const start = new Date(slot.start);
        const end = new Date(slot.end);
        if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end > start) {
          intervals.push({ start, end });
        }
      }
    }

    await this.cacheBusy(connection.id, from, to, intervals);
    await supabaseAdmin.from('calendar_connections')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', connection.id);

    return intervals;
  },

  /** Keep the last good answer, one row per UTC day. */
  async cacheBusy(connectionId: string, from: Date, to: Date, intervals: BusyInterval[]) {
    try {
      const byDay = new Map<string, { start: string; end: string }[]>();
      // Every day in the window gets a row, including the empty ones -
      // otherwise a day that is genuinely free is indistinguishable from a
      // day that was never fetched, and the cache would report it busy or
      // unknown forever.
      for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86_400_000)) {
        byDay.set(d.toISOString().slice(0, 10), []);
      }
      for (const i of intervals) {
        const key = i.start.toISOString().slice(0, 10);
        const list = byDay.get(key);
        if (list) list.push({ start: i.start.toISOString(), end: i.end.toISOString() });
      }

      const rows = [...byDay.entries()].map(([day, list]) => ({
        connection_id: connectionId,
        day,
        intervals: list,
        fetched_at: new Date().toISOString(),
      }));
      if (rows.length > 0 && rows.length <= 400) {
        await supabaseAdmin.from('calendar_busy_cache')
          .upsert(rows, { onConflict: 'connection_id,day' });
      }
    } catch (err: any) {
      // A cache that will not write is a worse answer next time, not an
      // error now.
      console.error(`[CalendarSync] Could not cache busy: ${err?.message || err}`);
    }
  },

  async cachedBusy(connectionId: string, from: Date, to: Date): Promise<BusyInterval[]> {
    try {
      const { data } = await supabaseAdmin
        .from('calendar_busy_cache')
        .select('intervals')
        .eq('connection_id', connectionId)
        .gte('day', from.toISOString().slice(0, 10))
        .lte('day', to.toISOString().slice(0, 10));

      const out: BusyInterval[] = [];
      for (const row of data || []) {
        for (const i of (row as any).intervals || []) {
          const start = new Date(i.start);
          const end = new Date(i.end);
          if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
            out.push({ start, end });
          }
        }
      }
      return out;
    } catch {
      return [];
    }
  },

  /**
   * Put a booking in the account's real calendar.
   *
   * Best effort, always. The meeting exists in Sincerely either way, and a
   * booking refused because Google was slow is a lost meeting for a reason
   * the prospect will never understand.
   */
  async pushEvent(userId: string, event: {
    id: string; title: string; start: Date; end: Date;
    inviteeEmail?: string | null; description?: string | null;
  }): Promise<void> {
    if (!googleConfigured()) return;
    try {
      const { data: connections } = await supabaseAdmin
        .from('calendar_connections')
        .select('id, access_token, refresh_token, expires_at, calendar_ids, write_events')
        .eq('user_id', userId)
        .eq('write_events', true)
        .is('broken_at', null)
        .limit(1);

      const connection = (connections || [])[0];
      if (!connection) return;

      const token = await this.accessTokenFor(connection);
      if (!token) return;

      const calendarId = connection.calendar_ids?.[0] || 'primary';
      const res = await authed(
        `${GOOGLE_EVENTS}/${encodeURIComponent(calendarId)}/events`,
        token,
        {
          method: 'POST',
          body: JSON.stringify({
            summary: event.title,
            description: event.description || undefined,
            start: { dateTime: event.start.toISOString() },
            end: { dateTime: event.end.toISOString() },
            attendees: event.inviteeEmail ? [{ email: event.inviteeEmail }] : undefined,
          }),
        },
      );

      if (res.ok && res.json?.id) {
        await supabaseAdmin.from('crm_events').update({
          external_event_id: res.json.id,
          external_connection_id: connection.id,
        }).eq('id', event.id);
      }
    } catch (err: any) {
      console.error(`[CalendarSync] Could not push event: ${err?.message || err}`);
    }
  },

  /** Take it back out again when it is cancelled. Best effort, as above. */
  async removeEvent(userId: string, eventId: string): Promise<void> {
    if (!googleConfigured()) return;
    try {
      const { data: event } = await supabaseAdmin
        .from('crm_events')
        .select('external_event_id, external_connection_id')
        .eq('id', eventId)
        .eq('user_id', userId)
        .maybeSingle();
      if (!event?.external_event_id || !event.external_connection_id) return;

      const { data: connection } = await supabaseAdmin
        .from('calendar_connections')
        .select('id, access_token, refresh_token, expires_at, calendar_ids')
        .eq('id', event.external_connection_id)
        .maybeSingle();
      if (!connection) return;

      const token = await this.accessTokenFor(connection);
      if (!token) return;

      const calendarId = connection.calendar_ids?.[0] || 'primary';
      await authed(
        `${GOOGLE_EVENTS}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(event.external_event_id)}`,
        token,
        { method: 'DELETE' },
      );
    } catch (err: any) {
      console.error(`[CalendarSync] Could not remove event: ${err?.message || err}`);
    }
  },
};

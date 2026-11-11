import crypto from 'node:crypto';
import { crmRequest, crmErrorMessage, CrmHttpError } from '../crm-sync/http.js';
import type { ExternalBooking, SchedulingAccount, SchedulingAdapter } from './types.js';

/**
 * Calendly (API v2, personal access token). Instant notifications need a
 * paid Calendly plan; on the free plan Sincerely checks for bookings on a
 * schedule instead. Notifications are signed:
 *   Calendly-Webhook-Signature: t=<unix>,v1=<hex HMAC-SHA256(key, "t.body")>
 */

const HOST = 'api.calendly.com';
const uuidOf = (uri: string | null | undefined) => String(uri || '').split('/').filter(Boolean).pop() || '';

function answersOf(qa: any): string | null {
  if (!Array.isArray(qa)) return null;
  const lines = qa.filter((q) => q?.answer).map((q) => `${q.question}: ${q.answer}`);
  return lines.length ? lines.join('\n').slice(0, 2000) : null;
}

function locationOf(loc: any): string | null {
  if (!loc) return null;
  return String(loc.join_url || loc.location || loc.type || '').slice(0, 500) || null;
}

export function calendlyAdapter(token: string): SchedulingAdapter {
  const headers = { Authorization: `Bearer ${token.trim()}` };

  async function call(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) {
    const res = await crmRequest(HOST, method, path, { headers, body });
    if (res.status >= 200 && res.status < 300) return res;
    if (res.status === 401) throw new CrmHttpError('Calendly rejected the token. Create a new one in Calendly under Integrations > API & Webhooks.', 401);
    throw new CrmHttpError(`Calendly answered ${res.status}: ${crmErrorMessage(res)}`, res.status);
  }

  const toBooking = (inv: any, ev: any, cancelled: boolean): ExternalBooking | null => {
    const email = String(inv?.email || '').trim().toLowerCase();
    const eventId = uuidOf(ev?.uri);
    if (!email || !eventId || !ev?.start_time) return null;
    return {
      key: `${eventId}:${email}`,
      bookingId: eventId,
      email,
      name: String(inv?.name || [inv?.first_name, inv?.last_name].filter(Boolean).join(' ') || email).slice(0, 120),
      title: String(ev?.name || 'Meeting').slice(0, 200),
      start: ev.start_time,
      end: ev.end_time || null,
      timezone: inv?.timezone || null,
      location: locationOf(ev?.location),
      answers: answersOf(inv?.questions_and_answers),
      cancelled,
      cancelReason: inv?.cancellation?.reason || null,
      // A reschedule names the invitee it replaces; its URI holds the old event's uuid.
      rescheduledFrom: inv?.old_invitee ? `${String(inv.old_invitee).split('/scheduled_events/')[1]?.split('/')[0] || ''}:${email}` : null,
    };
  };

  return {
    provider: 'calendly',
    label: 'Calendly',

    async me(): Promise<SchedulingAccount> {
      const res = await call('GET', '/users/me');
      const r = res.json?.resource;
      if (!r?.uri) throw new CrmHttpError('Calendly did not say who this token belongs to.', 502);
      return { id: String(r.uri), name: r.name || r.email || null, organization: r.current_organization || null };
    },

    async subscribe(url, secret, account) {
      const res = await crmRequest(HOST, 'POST', '/webhook_subscriptions', {
        headers,
        body: { url, events: ['invitee.created', 'invitee.canceled'], organization: account.organization, user: account.id, scope: 'user', signing_key: secret },
      });
      if (res.status >= 200 && res.status < 300) return { id: String(res.json?.resource?.uri || '') };
      // Free plans cannot subscribe ("Please upgrade your Calendly account").
      if (res.status === 403 || res.status === 402) return 'unavailable';
      // Already subscribed to this URL (a reconnect): find it and keep it.
      if (res.status === 409) {
        const list = await call('GET', `/webhook_subscriptions?${new URLSearchParams({ organization: String(account.organization || ''), user: account.id, scope: 'user', count: '100' })}`);
        const hit = (list.json?.collection || []).find((w: any) => w.callback_url === url);
        if (hit?.uri) {
          // Its signing key is the old one: replace it so ours verifies.
          await call('DELETE', `/webhook_subscriptions/${uuidOf(hit.uri)}`);
          return this.subscribe(url, secret, account);
        }
      }
      throw new CrmHttpError(`Calendly would not set up notifications (${res.status}): ${crmErrorMessage(res)}`, res.status);
    },

    async unsubscribe(id) {
      const uuid = uuidOf(id);
      if (!uuid) return;
      const res = await crmRequest(HOST, 'DELETE', `/webhook_subscriptions/${encodeURIComponent(uuid)}`, { headers });
      if (res.status >= 300 && res.status !== 404) throw new CrmHttpError(`Calendly answered ${res.status}: ${crmErrorMessage(res)}`, res.status);
    },

    verify(rawBody, hdrs, secret) {
      const header = String(hdrs['calendly-webhook-signature'] || '');
      const parts: Record<string, string> = {};
      for (const p of header.split(',')) {
        const i = p.indexOf('=');
        if (i > 0) parts[p.slice(0, i).trim()] = p.slice(i + 1).trim();
      }
      const t = Number(parts.t);
      if (!parts.v1 || !Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > 600) return false;
      const want = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
      const a = Buffer.from(want, 'hex');
      const b = Buffer.from(parts.v1, 'hex');
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    },

    parse(body) {
      const ev = body?.event;
      if (ev !== 'invitee.created' && ev !== 'invitee.canceled') return null;
      const p = body?.payload || {};
      // The cancel half of a reschedule: the new booking carries the move.
      if (ev === 'invitee.canceled' && p.rescheduled) return [];
      const b = toBooking(p, p.scheduled_event, ev === 'invitee.canceled');
      return b ? [b] : [];
    },

    async recent(account, since) {
      const bookings: ExternalBooking[] = [];
      const cancelledIds: string[] = [];
      for (const status of ['active', 'canceled'] as const) {
        const q = new URLSearchParams({ user: account.id, status, min_start_time: since, sort: 'start_time:asc', count: '100' });
        const res = await call('GET', `/scheduled_events?${q}`);
        for (const ev of res.json?.collection || []) {
          if (status === 'canceled') { cancelledIds.push(uuidOf(ev.uri)); continue; }
          const inv = await call('GET', `/scheduled_events/${encodeURIComponent(uuidOf(ev.uri))}/invitees?count=100`);
          for (const i of inv.json?.collection || []) {
            if (i?.status === 'canceled') continue;
            const b = toBooking(i, ev, false);
            if (b) bookings.push(b);
          }
        }
      }
      return { bookings, cancelledIds };
    },
  };
}

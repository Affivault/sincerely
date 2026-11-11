import crypto from 'node:crypto';
import { crmRequest, crmErrorMessage, CrmHttpError } from '../crm-sync/http.js';
import type { ExternalBooking, SchedulingAccount, SchedulingAdapter } from './types.js';

/**
 * Cal.com (API v2, API key from Settings > Developer > API keys). Webhooks
 * work on every plan. Notifications are signed:
 *   X-Cal-Signature-256: <hex HMAC-SHA256(secret, body)>
 */

const HOST = 'api.cal.com';
const VERSION = '2024-08-13';

export function calcomAdapter(apiKey: string): SchedulingAdapter {
  const headers = { Authorization: `Bearer ${apiKey.trim()}`, 'cal-api-version': VERSION };

  async function call(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) {
    const res = await crmRequest(HOST, method, path, { headers, body });
    if (res.status >= 200 && res.status < 300) return res;
    if (res.status === 401) throw new CrmHttpError('Cal.com rejected the API key. Create a new one in Cal.com under Settings > Developer > API keys.', 401);
    throw new CrmHttpError(`Cal.com answered ${res.status}: ${crmErrorMessage(res)}`, res.status);
  }

  const toBookings = (b: any, cancelled: boolean): ExternalBooking[] => {
    const uid = String(b?.uid || '');
    const start = b?.startTime || b?.start;
    if (!uid || !start) return [];
    const answers = b?.responses && typeof b.responses === 'object'
      ? Object.entries(b.responses)
          .filter(([k, v]) => !['name', 'email', 'guests', 'location'].includes(k) && v && typeof v !== 'object')
          .map(([k, v]) => `${k}: ${v}`).join('\n').slice(0, 2000) || null
      : (b?.description ? String(b.description).slice(0, 2000) : null);
    const from = b?.rescheduleUid || b?.fromReschedule || b?.rescheduledFromUid || null;
    return (Array.isArray(b?.attendees) ? b.attendees : [])
      .filter((a: any) => a?.email)
      .map((a: any) => {
        const email = String(a.email).trim().toLowerCase();
        return {
          key: `${uid}:${email}`,
          bookingId: uid,
          email,
          name: String(a.name || email).slice(0, 120),
          title: String(b.title || 'Meeting').slice(0, 200),
          start,
          end: b.endTime || b.end || null,
          timezone: a.timeZone || null,
          location: String(b.metadata?.videoCallUrl || b.meetingUrl || b.location || '').slice(0, 500) || null,
          answers,
          cancelled,
          cancelReason: b.cancellationReason || null,
          rescheduledFrom: from ? `${from}:${email}` : null,
        };
      });
  };

  return {
    provider: 'calcom',
    label: 'Cal.com',

    async me(): Promise<SchedulingAccount> {
      const res = await call('GET', '/v2/me');
      const d = res.json?.data;
      if (!d?.id) throw new CrmHttpError('Cal.com did not say who this API key belongs to.', 502);
      return { id: String(d.id), name: d.name || d.email || d.username || null };
    },

    async subscribe(url, secret) {
      const res = await crmRequest(HOST, 'POST', '/v2/webhooks', {
        headers,
        body: { active: true, subscriberUrl: url, triggers: ['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED'], secret },
      });
      if (res.status >= 200 && res.status < 300) return { id: String(res.json?.data?.id || '') };
      if (res.status === 403 || res.status === 402) return 'unavailable';
      throw new CrmHttpError(`Cal.com would not set up notifications (${res.status}): ${crmErrorMessage(res)}`, res.status);
    },

    async unsubscribe(id) {
      if (!id) return;
      const res = await crmRequest(HOST, 'DELETE', `/v2/webhooks/${encodeURIComponent(id)}`, { headers });
      if (res.status >= 300 && res.status !== 404) throw new CrmHttpError(`Cal.com answered ${res.status}: ${crmErrorMessage(res)}`, res.status);
    },

    verify(rawBody, hdrs, secret) {
      const got = String(hdrs['x-cal-signature-256'] || '');
      if (!/^[0-9a-f]{64}$/i.test(got)) return false;
      const want = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      return crypto.timingSafeEqual(Buffer.from(want, 'hex'), Buffer.from(got, 'hex'));
    },

    parse(body) {
      const t = body?.triggerEvent;
      if (t === 'PING') return [];
      if (t !== 'BOOKING_CREATED' && t !== 'BOOKING_RESCHEDULED' && t !== 'BOOKING_CANCELLED') return null;
      return toBookings(body?.payload, t === 'BOOKING_CANCELLED');
    },

    async recent(_account, since) {
      const bookings: ExternalBooking[] = [];
      const cancelledIds: string[] = [];
      for (const status of ['upcoming', 'cancelled'] as const) {
        const q = new URLSearchParams({ status, take: '100', afterStart: since });
        const res = await call('GET', `/v2/bookings?${q}`);
        for (const b of res.json?.data || []) {
          if (status === 'cancelled') { if (b?.uid) cancelledIds.push(String(b.uid)); continue; }
          bookings.push(...toBookings(b, false));
        }
      }
      return { bookings, cancelledIds };
    },
  };
}

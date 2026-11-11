/* ═══════════════════════════════════════════════════════════════════════
   Calendly and Cal.com, listen-only (migration 121).

   When somebody books through the account's own Calendly or Cal.com link,
   the meeting is treated exactly like a Sincerely booking:
     - recorded on the calendar and the contact's timeline (the contact is
       created when they are new);
     - their sequences stop (stopSequencesForMeeting): nobody gets a
       follow-up after putting a call in the diary;
     - a deal opens, or the open one moves forward;
     - a connected HubSpot or Pipedrive hears about it;
     - a cancellation marks the meeting cancelled, a reschedule moves it.

   Nothing is ever written back to Calendly or Cal.com.

   Bookings arrive two ways. Where the plan allows, the tool notifies
   Sincerely the moment someone books (a signed webhook to
   /api/hooks/scheduling/<provider>/<connection>). Where it does not
   (Calendly's free plan), Sincerely checks every 5 minutes. Instant
   connections are also checked every 6 hours, in case a notification was
   lost. Each booking is recorded once however often it is seen
   (crm_events.external_id is unique per account).
   ═══════════════════════════════════════════════════════════════════════ */

import crypto from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { AppError } from '../middleware/error.middleware.js';
import { calendlyAdapter } from './scheduling/calendly.js';
import { calcomAdapter } from './scheduling/calcom.js';
import type { ExternalBooking, SchedulingAdapter } from './scheduling/types.js';
import { publicBookingService } from './booking.service.js';
import { stopSequencesForMeeting } from './meeting-stop.service.js';
import { notifyCrmsOfMeeting } from './crm-sync.service.js';

export type SchedulingProvider = 'calendly' | 'calcom';
export const isSchedulingProvider = (p: string): p is SchedulingProvider => p === 'calendly' || p === 'calcom';

const CHECK_EVERY_MS = 5 * 60_000;
const SAFETY_CHECK_MS = 6 * 3_600_000;
const LOOK_BACK_MS = 24 * 3_600_000;

export function schedulingAdapter(provider: SchedulingProvider, config: Record<string, string>): SchedulingAdapter {
  if (provider === 'calendly') {
    if (!config.access_token) throw new AppError('Calendly is not connected (no token).', 400);
    return calendlyAdapter(config.access_token);
  }
  if (!config.api_key) throw new AppError('Cal.com is not connected (no API key).', 400);
  return calcomAdapter(config.api_key);
}

export function hookUrl(provider: SchedulingProvider, integrationId: string): string {
  return `${env.API_BASE_URL.replace(/\/+$/, '')}/api/hooks/scheduling/${provider}/${integrationId}`;
}

interface Row {
  id: string;
  user_id: string;
  provider: string;
  config: Record<string, string>;
  is_active: boolean;
}

async function saveConfig(id: string, config: Record<string, string>, extra: Record<string, unknown> = {}) {
  const { error } = await supabaseAdmin.from('user_integrations').update({ config, ...extra }).eq('id', id);
  // Before migration 118 there is no next_sync_at: keep the config at least.
  if (error && extra.next_sync_at) await supabaseAdmin.from('user_integrations').update({ config }).eq('id', id);
}

async function logActivity(integrationId: string, summary: string, success = true, detail?: string) {
  await supabaseAdmin.from('integration_activity').insert({
    integration_id: integrationId, event_type: 'meeting.booked', summary: summary.slice(0, 500), success, detail: detail?.slice(0, 1000) ?? null,
  }).then(() => undefined, () => undefined);
}

/**
 * After connecting: learn whose account it is, ask for instant notifications
 * (or fall back to checking), and pick up meetings already booked so their
 * sequences stop now rather than after their next email.
 */
export async function setUpScheduling(row: Row): Promise<{ mode: 'instant' | 'checking'; detail: string }> {
  const provider = row.provider as SchedulingProvider;
  const adapter = schedulingAdapter(provider, row.config);
  const account = await adapter.me();
  const config: Record<string, string> = { ...row.config, account_id: account.id, account_name: account.name || '' };
  if (account.organization) config.organization = account.organization;

  // A reconnect replaces the old subscription rather than adding a second.
  if (config.webhook_id) await adapter.unsubscribe(config.webhook_id).catch(() => undefined);
  const secret = crypto.randomBytes(32).toString('hex');
  const sub = await adapter.subscribe(hookUrl(provider, row.id), secret, account);
  if (sub === 'unavailable') {
    delete config.webhook_id;
    delete config.webhook_secret;
    config.mode = 'checking';
  } else {
    config.webhook_id = sub.id;
    config.webhook_secret = secret;
    config.mode = 'instant';
  }
  await saveConfig(row.id, config);
  const fresh = { ...row, config };
  await checkScheduling(fresh).catch((err) => console.warn(`[Scheduling] first check ${row.id}: ${err?.message || err}`));
  return config.mode === 'instant'
    ? { mode: 'instant', detail: `Connected to ${adapter.label}${account.name ? ` as ${account.name}` : ''}. New bookings arrive the moment they are made.` }
    : { mode: 'checking', detail: `Connected to ${adapter.label}${account.name ? ` as ${account.name}` : ''}. Your plan does not send instant notifications, so Sincerely checks for new bookings every 5 minutes.` };
}

/** When the connection is removed: stop the tool notifying us. Best effort. */
export async function tearDownScheduling(row: Row): Promise<void> {
  if (!row.config?.webhook_id) return;
  try {
    await schedulingAdapter(row.provider as SchedulingProvider, row.config).unsubscribe(row.config.webhook_id);
  } catch (err: any) {
    console.warn(`[Scheduling] unsubscribe ${row.id}: ${err?.message || err}`);
  }
}

/** A notification from Calendly or Cal.com. Answers with an HTTP status. */
export async function handleSchedulingHook(
  provider: string,
  integrationId: string,
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
): Promise<{ status: number; body: unknown }> {
  if (!isSchedulingProvider(provider) || !/^[0-9a-f-]{36}$/i.test(integrationId)) return { status: 404, body: { error: 'Not found' } };
  const { data: row } = await supabaseAdmin.from('user_integrations').select('*').eq('id', integrationId).eq('provider', provider).maybeSingle();
  // Gone or paused: 410 tells the tool to stop sending.
  if (!row) return { status: 410, body: { error: 'This connection no longer exists' } };
  const r = row as Row;
  const secret = r.config?.webhook_secret;
  const adapter = schedulingAdapter(provider, r.config);
  if (!secret || !adapter.verify(rawBody, headers, secret)) return { status: 401, body: { error: 'Signature does not match' } };
  if (!r.is_active) return { status: 200, body: { ok: true, ignored: 'paused' } };
  let body: any;
  try { body = JSON.parse(rawBody); } catch { return { status: 400, body: { error: 'Not JSON' } }; }
  const bookings = adapter.parse(body);
  if (!bookings) return { status: 200, body: { ok: true, ignored: true } };
  for (const b of bookings) await recordBooking(r, adapter.label, b);
  return { status: 200, body: { ok: true } };
}

/** Check for bookings (accounts without notifications, and the safety net for the rest). */
export async function checkScheduling(row: Row): Promise<{ recorded: number }> {
  const provider = row.provider as SchedulingProvider;
  const adapter = schedulingAdapter(provider, row.config);
  const account = { id: row.config.account_id || (await adapter.me()).id, name: row.config.account_name || null, organization: row.config.organization || null };
  const since = new Date(Date.now() - LOOK_BACK_MS).toISOString();
  const { bookings, cancelledIds } = await adapter.recent(account, since);
  let recorded = 0;
  for (const b of bookings) if ((await recordBooking(row, adapter.label, b)) === 'created') recorded++;
  for (const id of cancelledIds) await cancelBooking(row, adapter.label, id, null);
  const every = row.config.mode === 'instant' ? SAFETY_CHECK_MS : CHECK_EVERY_MS;
  await supabaseAdmin.from('user_integrations').update({
    last_sync_at: new Date().toISOString(),
    next_sync_at: new Date(Date.now() + every).toISOString(),
    last_sync_error: null,
  }).eq('id', row.id).then(() => undefined, () => undefined);
  return { recorded };
}

/** For the scheduler: Calendly / Cal.com connections due a check. Cross-tenant. */
export async function dueSchedulingChecks(limit = 20): Promise<Row[]> {
  const { data, error } = await supabaseAdmin
    .from('user_integrations')
    .select('*')
    .in('provider', ['calendly', 'calcom'])
    .eq('is_active', true)
    .lte('next_sync_at', new Date().toISOString())
    .order('next_sync_at', { ascending: true })
    .limit(limit);
  if (error) return [];
  return (data || []) as Row[];
}

async function cancelBooking(row: Row, label: string, bookingId: string, reason: string | null, key?: string): Promise<number> {
  let q = supabaseAdmin.from('crm_events')
    .update({ status: 'cancelled' })
    .eq('user_id', row.user_id)
    .eq('external_source', row.provider)
    .neq('status', 'cancelled');
  q = key ? q.eq('external_id', key) : q.like('external_id', `${bookingId.replace(/[%_\\]/g, '')}:%`);
  const { data, error } = await q.select('id, contact_id, title');
  if (error) throw error;
  for (const e of (data || []) as any[]) {
    await publicBookingService.logActivity(row.user_id, e.contact_id, `Cancelled the ${label} meeting "${e.title}"${reason ? `: ${reason}` : ''}`);
    await logActivity(row.id, `Meeting cancelled in ${label}: ${e.title}`);
  }
  return (data || []).length;
}

/** The campaign that was emailing them, for the meeting's attribution. */
async function lastCampaignOf(userId: string, contactId: string | null): Promise<string | null> {
  if (!contactId) return null;
  const { data } = await supabaseAdmin
    .from('campaign_contacts')
    .select('campaign_id, campaigns!inner(user_id)')
    .eq('contact_id', contactId)
    .eq('campaigns.user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);
  return ((data || []) as any[])[0]?.campaign_id ?? null;
}

const whenText = (iso: string, tz: string | null) => {
  try {
    return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz || 'UTC' }) + (tz ? '' : ' UTC');
  } catch {
    return new Date(iso).toUTCString();
  }
};

/**
 * One booking from Calendly or Cal.com, recorded like a Sincerely booking.
 * Idempotent: the same booking seen twice is recorded once.
 */
export async function recordBooking(row: Row, label: string, b: ExternalBooking): Promise<'created' | 'moved' | 'cancelled' | 'known'> {
  const userId = row.user_id;
  if (b.cancelled) {
    await cancelBooking(row, label, b.bookingId, b.cancelReason ?? null, b.key);
    return 'cancelled';
  }

  // A reschedule moves the meeting it replaces.
  if (b.rescheduledFrom) {
    const { data: moved } = await supabaseAdmin.from('crm_events')
      .update({ starts_at: b.start, ends_at: b.end, external_id: b.key, status: 'confirmed', title: b.title })
      .eq('user_id', userId).eq('external_source', row.provider).eq('external_id', b.rescheduledFrom)
      .select('id, contact_id');
    if (moved && moved.length) {
      for (const e of moved as any[]) await publicBookingService.logActivity(userId, e.contact_id, `Moved the ${label} meeting "${b.title}" to ${whenText(b.start, b.timezone)}`);
      await logActivity(row.id, `Meeting moved in ${label}: ${b.title}, ${b.email}`);
      return 'moved';
    }
  }

  const { data: known } = await supabaseAdmin.from('crm_events').select('id')
    .eq('user_id', userId).eq('external_source', row.provider).eq('external_id', b.key).maybeSingle();
  if (known) return 'known';

  const contactId = await publicBookingService.upsertContact(userId, { email: b.email, name: b.name });
  const campaignId = await lastCampaignOf(userId, contactId);
  const { data: ev, error } = await supabaseAdmin.from('crm_events').insert({
    user_id: userId,
    title: `${b.title} with ${b.name}`.slice(0, 240),
    type: 'meeting',
    starts_at: b.start,
    ends_at: b.end,
    contact_id: contactId,
    contact_name: b.name,
    contact_email: b.email,
    location: b.location,
    notes: b.answers,
    status: 'confirmed',
    invitee_timezone: b.timezone,
    booked_at: new Date().toISOString(),
    source_campaign_id: campaignId,
    external_source: row.provider,
    external_id: b.key,
  }).select('id').single();
  if (error) {
    // Seen at the same moment by a notification and a check: the other one recorded it.
    if (/duplicate key|23505/.test(`${error.message} ${(error as any).code}`)) return 'known';
    await logActivity(row.id, `Could not record the ${label} meeting with ${b.email}`, false, error.message);
    throw error;
  }
  const eventId = (ev as any).id as string;

  const stopped = await stopSequencesForMeeting(userId, contactId, `through ${label}`);
  await Promise.allSettled([
    row.config?.create_deals !== 'no'
      ? publicBookingService.openDeal({ user_id: userId, deal_stage: 'qualified', headline: b.title }, eventId, contactId, { name: b.name, email: b.email })
      : Promise.resolve(),
    publicBookingService.logActivity(userId, contactId, `Booked "${b.title}" through ${label} for ${whenText(b.start, b.timezone)}`),
    contactId ? notifyCrmsOfMeeting(userId, { contact_id: contactId, title: b.title, starts_at: b.start, via: label, campaign_id: campaignId }) : Promise.resolve(),
  ]);
  await logActivity(row.id, `Meeting booked in ${label}: ${b.title} with ${b.name} (${b.email})${stopped ? `, ${stopped} sequence${stopped === 1 ? '' : 's'} stopped` : ''}`);
  return 'created';
}

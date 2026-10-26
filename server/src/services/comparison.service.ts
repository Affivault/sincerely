/* ═══════════════════════════════════════════════════════════════════════
   Two cuts of the numbers analytics already has.

   Campaigns side by side: two to four of them, every figure on the same
   definition as the campaigns list (get_campaigns_stats, migration 085),
   plus the outcomes that list does not carry - positive replies and
   meetings - counted the way the Results report counts them.

   Results by sender: the same funnel grouped by the mailbox that sent
   each email and by that mailbox's domain, so "which mailbox is dragging
   the reply rate down" has an answer that is not a guess.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { fetchAllPages, PAGE_ROWS } from '../utils/batch.js';
import {
  percentOf, senderRow, COMPARE_MIN, COMPARE_MAX,
  type CampaignComparisonRow, type SenderResultRow, type SenderResultsReport,
} from '@lemlist/shared';

/** Replies read as interested or asking to meet: the Results report's "positive". */
const POSITIVE = ['interested', 'meeting'];

/** Rows read per kind before the by-sender report says it is a floor. */
const MAX_ROWS = 200_000;
/** The longest range the by-sender report reads at once. */
const MAX_RANGE_DAYS = 366;
const DAY = 86_400_000;

type Counts = { sent: number; reached: number; attempted: number; opened: number; clicked: number; replied: number; bounced: number; unsubscribed: number };

/** Per-campaign people counts from raw activity, for a database without 085. */
async function rollupFromActivity(campaignId: string): Promise<Counts> {
  const rows = await fetchAllPages<{ campaign_contact_id: string | null; activity_type: string }>((from, to) => supabaseAdmin
    .from('campaign_activities')
    .select('campaign_contact_id, activity_type')
    .eq('campaign_id', campaignId)
    .in('activity_type', ['sent', 'opened', 'clicked', 'replied', 'bounced'])
    .order('id', { ascending: true })
    .range(from, to));
  const per = new Map<string, Set<string>>();
  let sent = 0;
  for (const r of rows) {
    if (r.activity_type === 'sent') sent++;
    if (!r.campaign_contact_id) continue;
    let s = per.get(r.campaign_contact_id);
    if (!s) { s = new Set(); per.set(r.campaign_contact_id, s); }
    s.add(r.activity_type);
  }
  const c: Counts = { sent, reached: 0, attempted: 0, opened: 0, clicked: 0, replied: 0, bounced: 0, unsubscribed: 0 };
  for (const s of per.values()) {
    if (s.has('sent')) c.reached++;
    if (s.has('sent') || s.has('bounced')) c.attempted++;
    if (s.has('opened')) c.opened++;
    if (s.has('clicked')) c.clicked++;
    if (s.has('replied')) c.replied++;
    if (s.has('bounced')) c.bounced++;
  }
  const { count } = await supabaseAdmin.from('campaign_contacts')
    .select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).eq('status', 'unsubscribed');
  c.unsubscribed = count || 0;
  return c;
}

function parseDay(v: unknown): Date | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Page through a query, stopping at the ceiling instead of reading forever. */
async function readCapped<R>(page: (from: number, to: number) => PromiseLike<{ data: R[] | null; error: { message: string } | null }>): Promise<{ rows: R[]; truncated: boolean }> {
  const rows: R[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_ROWS) {
    const { data, error } = await page(from, from + PAGE_ROWS - 1);
    if (error) throw new AppError(error.message, 500);
    const got = data || [];
    rows.push(...got);
    if (got.length < PAGE_ROWS) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

interface Bucket {
  sent: number;
  reached: Set<string>; attempted: Set<string>;
  opened: Set<string>; clicked: Set<string>; replied: Set<string>;
  bounced: Set<string>; complained: Set<string>;
}
const bucket = (): Bucket => ({
  sent: 0, reached: new Set(), attempted: new Set(), opened: new Set(), clicked: new Set(),
  replied: new Set(), bounced: new Set(), complained: new Set(),
});

export const comparisonService = {
  async campaigns(userId: string, rawIds: unknown): Promise<CampaignComparisonRow[]> {
    const list = Array.isArray(rawIds) ? rawIds : typeof rawIds === 'string' ? rawIds.split(',') : [];
    const ids = [...new Set(list.map((v) => String(v).trim()).filter(Boolean))];
    if (ids.length < COMPARE_MIN || ids.length > COMPARE_MAX) {
      throw new AppError(`Pick ${COMPARE_MIN} to ${COMPARE_MAX} campaigns to compare`, 400);
    }

    const { data: camps, error } = await supabaseAdmin
      .from('campaigns')
      .select('id, name, status')
      .eq('user_id', userId)
      .in('id', ids);
    if (error) throw new AppError(error.message, 500);
    if (!camps || camps.length !== ids.length) throw new AppError('Campaign not found', 404);
    // Every read below is by these ids, and they are now known to be the caller's.
    const owned = ids;

    const counts = new Map<string, Counts>();
    const { data: stats, error: statsErr } = await supabaseAdmin.rpc('get_campaigns_stats', { p_campaign_ids: owned });
    const n = (v: any) => Number(v) || 0;
    if (!statsErr && Array.isArray(stats) && stats.length > 0) {
      for (const r of stats as any[]) {
        const reached = r.contacts_reached != null ? n(r.contacts_reached) : n(r.sent_count);
        counts.set(r.campaign_id, {
          sent: n(r.sent_count),
          reached,
          attempted: r.contacts_attempted != null ? n(r.contacts_attempted) : reached,
          opened: n(r.opened_count),
          clicked: n(r.clicked_count),
          replied: n(r.replied_count),
          bounced: n(r.bounced_count),
          unsubscribed: n(r.unsubscribed_contacts),
        });
      }
    }
    for (const id of owned) {
      if (!counts.has(id)) {
        if (statsErr) console.error('[Compare] get_campaigns_stats unavailable, counting from activity:', statsErr.message);
        counts.set(id, await rollupFromActivity(id));
      }
    }

    // Positive replies are people, as everywhere else: one per prospect per campaign.
    const positivePeople = new Map<string, Set<string>>();
    try {
      const msgs = await fetchAllPages<{ id: string; campaign_id: string; contact_id: string | null; from_email: string | null }>((from, to) => supabaseAdmin
        .from('inbox_messages')
        .select('id, campaign_id, contact_id, from_email')
        .eq('user_id', userId)
        .eq('direction', 'inbound')
        .in('campaign_id', owned)
        .in('sara_intent', POSITIVE)
        .order('id', { ascending: true })
        .range(from, to));
      for (const m of msgs) {
        let s = positivePeople.get(m.campaign_id);
        if (!s) { s = new Set(); positivePeople.set(m.campaign_id, s); }
        s.add(m.contact_id || (m.from_email || '').toLowerCase() || m.id);
      }
    } catch (err: any) {
      console.error('[Compare] positive replies unavailable:', err?.message ?? String(err));
    }

    const meetings = new Map<string, number>();
    const { data: events, error: evErr } = await supabaseAdmin
      .from('crm_events')
      .select('id, source_campaign_id')
      .eq('user_id', userId)
      .eq('type', 'meeting')
      .in('source_campaign_id', owned)
      .is('cancelled_at', null)
      .limit(10000);
    if (evErr) console.error('[Compare] meetings unavailable:', evErr.message);
    for (const e of (events || []) as any[]) meetings.set(e.source_campaign_id, (meetings.get(e.source_campaign_id) || 0) + 1);

    // In the order they were picked, so the columns match the picker.
    const byId = new Map((camps as any[]).map((c) => [c.id, c]));
    return owned.map((id) => {
      const c = counts.get(id)!;
      const camp = byId.get(id);
      const positive = positivePeople.get(id)?.size || 0;
      const met = meetings.get(id) || 0;
      return {
        id,
        name: camp.name,
        status: camp.status,
        ...c,
        positive,
        meetings: met,
        open_rate: percentOf(c.opened, c.reached),
        click_rate: percentOf(c.clicked, c.reached),
        reply_rate: percentOf(c.replied, c.reached),
        positive_rate: percentOf(positive, c.reached),
        meeting_rate: percentOf(met, c.reached),
        bounce_rate: percentOf(c.bounced, c.attempted),
        unsubscribe_rate: percentOf(c.unsubscribed, c.reached),
      };
    });
  },

  /**
   * Sends, opens, replies, bounces and complaints by the mailbox that sent
   * them, and by its domain, over [from, to].
   *
   * Only a 'sent' row says which mailbox sent (metadata.smtp_account_id).
   * Opens and replies are credited to the mailbox of the person's latest
   * send in the range - the email they were most likely answering - and,
   * as everywhere in analytics, each person counts once. The cohort is the
   * people sent to in the range, engaging in it, so no rate passes 100%.
   */
  async bySender(userId: string, fromRaw: unknown, toRaw: unknown): Promise<SenderResultsReport> {
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const toDay = parseDay(toRaw) || today;
    const fromDay = parseDay(fromRaw) || new Date(toDay.getTime() - 29 * DAY);
    if (fromDay > toDay) throw new AppError('The start of the range must be before its end', 400);
    if ((toDay.getTime() - fromDay.getTime()) / DAY >= MAX_RANGE_DAYS) throw new AppError(`Choose a range of at most ${MAX_RANGE_DAYS} days`, 400);
    const since = fromDay.toISOString();
    const until = new Date(toDay.getTime() + DAY).toISOString();

    const accountsRes = await supabaseAdmin.from('smtp_accounts').select('id, label, email_address').eq('user_id', userId);
    if (accountsRes.error) throw new AppError(accountsRes.error.message, 500);
    const accounts = new Map(((accountsRes.data || []) as any[]).map((a) => [a.id, a]));

    const activity = (types: string[], cols: string) => readCapped<any>((from, to) => supabaseAdmin
      .from('campaign_activities')
      .select(`${cols}, campaigns!inner(user_id)`)
      .eq('campaigns.user_id', userId)
      .in('activity_type', types)
      .gte('occurred_at', since)
      .lt('occurred_at', until)
      .order('occurred_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to));

    const [sends, engagement, refusals] = await Promise.all([
      activity(['sent'], 'campaign_contact_id, account:metadata->>smtp_account_id'),
      activity(['opened', 'clicked', 'replied'], 'campaign_contact_id, activity_type'),
      activity(['bounced', 'complained'], 'campaign_contact_id, activity_type, account:metadata->>smtp_account_id'),
    ]);

    const UNRECORDED = 'unrecorded';
    const mailboxKey = (account: string | null | undefined) => account || UNRECORDED;
    const domainKey = (key: string) => {
      if (key === UNRECORDED) return UNRECORDED;
      const email = accounts.get(key)?.email_address;
      return email ? (String(email).split('@')[1] || '').toLowerCase() || UNRECORDED : 'removed';
    };

    const byMailbox = new Map<string, Bucket>();
    const byDomain = new Map<string, Bucket>();
    const both = (key: string): Bucket[] => {
      const d = domainKey(key);
      if (!byMailbox.has(key)) byMailbox.set(key, bucket());
      if (!byDomain.has(d)) byDomain.set(d, bucket());
      return [byMailbox.get(key)!, byDomain.get(d)!];
    };

    // Sends in time order, so the last one seen per person is their latest.
    const latest = new Map<string, string>();
    for (const s of sends.rows) {
      const key = mailboxKey(s.account);
      for (const b of both(key)) {
        b.sent++;
        if (s.campaign_contact_id) { b.reached.add(s.campaign_contact_id); b.attempted.add(s.campaign_contact_id); }
      }
      if (s.campaign_contact_id) latest.set(s.campaign_contact_id, key);
    }
    for (const e of engagement.rows) {
      const key = e.campaign_contact_id ? latest.get(e.campaign_contact_id) : undefined;
      if (!key) continue; // not sent to in this range: outside the cohort
      const kind = e.activity_type as 'opened' | 'clicked' | 'replied';
      for (const b of both(key)) b[kind].add(e.campaign_contact_id);
    }
    // A refusal with no enrolment is still one refusal, so it gets a key of its own.
    let anonymous = 0;
    for (const r of refusals.rows) {
      const person = r.campaign_contact_id || `anon:${anonymous++}`;
      const key = r.account || (r.campaign_contact_id ? latest.get(r.campaign_contact_id) : undefined) || UNRECORDED;
      for (const b of both(key)) {
        if (r.activity_type === 'bounced') { b.bounced.add(person); b.attempted.add(person); }
        else b.complained.add(person);
      }
    }

    const toRow = (b: Bucket, base: { key: string; label: string; email: string | null; domain: string | null }) =>
      senderRow(base, counts(b));
    const counts = (b: Bucket) => ({
      sent: b.sent, reached: b.reached.size, attempted: b.attempted.size, opened: b.opened.size,
      clicked: b.clicked.size, replied: b.replied.size, bounced: b.bounced.size, complained: b.complained.size,
    });

    const mailboxes = [...byMailbox.entries()].map(([key, b]) => {
      const a = accounts.get(key);
      const label = key === UNRECORDED ? 'Not recorded' : a ? (a.label || a.email_address) : 'Removed mailbox';
      return toRow(b, { key, label, email: a?.email_address ?? null, domain: a ? domainKey(key) : null });
    });
    const domains = [...byDomain.entries()].map(([key, b]) =>
      toRow(b, {
        key,
        label: key === UNRECORDED ? 'Not recorded' : key === 'removed' ? 'Removed mailboxes' : key,
        email: null,
        domain: key === UNRECORDED || key === 'removed' ? null : key,
      }));
    const bySent = (x: SenderResultRow, y: SenderResultRow) => y.sent - x.sent || x.label.localeCompare(y.label);

    return {
      from: since,
      to: until,
      mailboxes: mailboxes.sort(bySent),
      domains: domains.sort(bySent),
      truncated: sends.truncated || engagement.truncated || refusals.truncated,
    };
  },
};

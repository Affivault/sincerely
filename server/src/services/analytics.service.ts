import { supabaseAdmin } from '../config/supabase.js';
import { twoProportionPValue, wilsonLowerBound, wilsonUpperBound } from '../utils/stats.js';
import { AppError } from '../middleware/error.middleware.js';
import { MIN_STEP_SENDS, revenueByCampaign, valuePerReply, outreachFunnel, dealValue } from '@lemlist/shared';
import { readVariant } from '@lemlist/shared';
import type { SequencePerformance, SequenceStepPerformance, StepVerdict } from '@lemlist/shared';

function calcRate(value: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((value / total) * 100 * 10) / 10;
}

function calcChange(current: number, prev: number): number | null {
  if (prev === 0) return current > 0 ? 100 : null;
  return Math.round(((current - prev) / prev) * 1000) / 10;
}

/** Relative change of a rate between two periods; null when either has no base. */
function rateChange(num: number, den: number, prevNum: number, prevDen: number): number | null {
  if (den === 0 || prevDen === 0) return null;
  const now = num / den;
  const before = prevNum / prevDen;
  if (before === 0) return now > 0 ? 100 : 0;
  return Math.round(((now - before) / before) * 1000) / 10;
}

/**
 * Midnight UTC at the start of the day `daysBack` days before today.
 *
 * Windows start on a day boundary, not at "now minus N x 24h": the trend
 * chart buckets whole UTC days, so a rolling start dropped the early hours
 * of its oldest day and the chart's total never matched the headline above
 * it. A period of N days is today plus the N-1 whole days before it.
 */
function utcDayStart(daysBack: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d;
}

/** [since, until) of the last `days` days, and of the `days` before that. */
function periodWindows(days: number) {
  const since = utcDayStart(days - 1);
  const prevSince = new Date(since.getTime() - days * 86_400_000);
  return { since: since.toISOString(), prevSince: prevSince.toISOString(), prevUntil: since.toISOString() };
}

/** Activity types that are counted as engagement. Machine hits never are. */
const MACHINE_TYPES = '(machine_open,machine_click)';

/**
 * Per-enrolment rollup of activity rows: messages sent, and whether each
 * person opened / clicked / replied / bounced. Opens, clicks and replies
 * are people, not events - someone who replies twice is one reply - so
 * every rate built from this is "of the people reached, how many ...".
 */
type PersonRollup = { sent: number; opened: boolean; clicked: boolean; replied: boolean; bounced: boolean };
function rollupPeople(rows: { campaign_contact_id?: string | null; contact_id?: string | null; activity_type: string }[]) {
  const people = new Map<string, PersonRollup>();
  let sentMessages = 0;
  for (const a of rows) {
    const key = a.campaign_contact_id || a.contact_id;
    if (!key) continue;
    let p = people.get(key);
    if (!p) { p = { sent: 0, opened: false, clicked: false, replied: false, bounced: false }; people.set(key, p); }
    switch (a.activity_type) {
      case 'sent': p.sent++; sentMessages++; break;
      case 'opened': p.opened = true; break;
      case 'clicked': p.clicked = true; break;
      case 'replied': p.replied = true; break;
      case 'bounced': p.bounced = true; break;
    }
  }
  const t = { sent: sentMessages, reached: 0, attempted: 0, opened: 0, clicked: 0, replied: 0, bounced: 0 };
  for (const p of people.values()) {
    if (p.sent > 0) t.reached++;
    if (p.sent > 0 || p.bounced) t.attempted++;
    if (p.opened) t.opened++;
    if (p.clicked) t.clicked++;
    if (p.replied) t.replied++;
    if (p.bounced) t.bounced++;
  }
  return t;
}

/**
 * Daily series over whole UTC days, today and the `days - 1` before it.
 * Sends are emails; opens, clicks, replies and bounces are people, each
 * counted once on the first day they did it in the window - so a prospect
 * who replies twice adds one reply, as in every other figure.
 */
function bucketByDay<K extends string>(
  rows: { activity_type: string; occurred_at: string; campaign_contact_id?: string | null }[],
  days: number,
  keys: K[],
): ({ date: string } & Record<K, number>)[] {
  const blank = () => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  const byDate = new Map<string, Record<K, number>>();
  const start = utcDayStart(days - 1);
  for (let i = 0; i < days; i++) {
    byDate.set(new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10), blank());
  }
  const seen = new Set<string>();
  const sorted = [...rows].sort((a, b) => (a.occurred_at || '').localeCompare(b.occurred_at || ''));
  for (const a of sorted) {
    const day = byDate.get(a.occurred_at?.slice(0, 10) ?? '');
    if (!day || !(keys as string[]).includes(a.activity_type)) continue;
    const k = a.activity_type as K;
    if (k !== 'sent' && a.campaign_contact_id) {
      const key = `${k}:${a.campaign_contact_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    day[k]++;
  }
  return [...byDate.entries()].map(([date, counts]) => ({ date, ...counts }));
}

const ACTIVITY_PAGE_SIZE = 1000;

// Supabase caps a single select at ~1000 rows (see lists.service.ts's
// getContactsInList / segments.service.ts's fetchAllContactIds). Every
// analytics query below reads raw campaign_activities rows to aggregate
// counts client-side, so without paging, any campaign/account that has
// accumulated more than 1000 activity rows would silently undercount
// sent/opened/clicked/replied — wrong rates, a wrong A/B winner, a
// truncated CSV export, and an incomplete heatmap/funnel.
async function fetchAllRows<T = any>(buildQuery: (from: number, to: number) => any): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += ACTIVITY_PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + ACTIVITY_PAGE_SIZE - 1);
    if (error) throw new AppError(error.message, 500);
    const chunk: T[] = data || [];
    rows.push(...chunk);
    if (chunk.length < ACTIVITY_PAGE_SIZE) break;
  }
  return rows;
}

/* ═══════════════════════════════════════════════════════════════════════
   Deciding an A/B test.

   This used to call a result "statistically significant" when the two open
   rates differed by two percentage points and each arm had thirty sends.
   That is not significance, it is a rounding error with a rosette on it:
   at n=30, two points is one extra open, and a coin lands that way all the
   time. Telling someone to rewrite their sequence on the strength of it is
   worse than telling them nothing.

   Now it runs a real two-proportion z-test and reports the p-value, which
   also means the promote-the-winner button below is acting on something.
   ═══════════════════════════════════════════════════════════════════════ */

/** Below this per arm, don't call it either way however tempting the gap. */
const MIN_AB_SAMPLE = 30;
/** Two-sided. The convention, and strict enough to keep noise out. */
const AB_ALPHA = 0.05;

export const analyticsService = {
  async overview(userId: string, days?: number) {
    const { count: totalCampaigns } = await supabaseAdmin
      .from('campaigns')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    const { count: activeCampaigns } = await supabaseAdmin
      .from('campaigns')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'running');

    const { count: totalContacts } = await supabaseAdmin
      .from('contacts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    const { data: campaigns } = await supabaseAdmin
      .from('campaigns')
      .select('id')
      .eq('user_id', userId);

    const campaignIds = (campaigns || []).map((c: any) => c.id);

    /*
     * A cohort, not two unrelated counts. The rates are "of the people sent
     * to in this period, how many opened / clicked / replied within it":
     * dividing this period's opens by this period's sends counted opens of
     * last month's emails against this week's sends, and a quiet week after
     * a busy one read as a 200% open rate. Opens, clicks and replies are
     * people (distinct enrolments), so a prospect who replies twice is one
     * reply. See get_engagement_summary in migration 085.
     */
    type Summary = { sent: number; contacts: number; opened: number; clicked: number; replied: number };
    const empty: Summary = { sent: 0, contacts: 0, opened: 0, clicked: 0, replied: 0 };
    let cur: Summary = { ...empty };
    let prev: Summary = { ...empty };

    if (campaignIds.length > 0) {
      const win = days ? periodWindows(days) : null;

      const summarise = async (since: string | null, until: string | null): Promise<Summary> => {
        const { data, error } = await supabaseAdmin.rpc('get_engagement_summary', {
          p_user_id: userId, p_since: since, p_until: until,
        });
        const row = Array.isArray(data) ? data[0] : data;
        if (!error && row) {
          return {
            sent: Number(row.sent_messages) || 0,
            contacts: Number(row.contacts_sent) || 0,
            opened: Number(row.contacts_opened) || 0,
            clicked: Number(row.contacts_clicked) || 0,
            replied: Number(row.contacts_replied) || 0,
          };
        }
        // Without migration 085 the cohort function does not exist. Fall
        // back to plain counts, clamped so no rate can claim more than
        // everyone - logged, because the figures are rougher.
        console.error('[Analytics] get_engagement_summary unavailable, using event counts:', error?.message ?? 'no row');
        /*
         * Scoped by owner through the join, not by an id list. Every campaign the
         * account has went into one `in` filter, which is a URL a few hundred
         * campaigns long - past what the gateway accepts - so the dashboard,
         * trend and revenue pages went blank for exactly the busiest accounts.
         */
        const makeCountQuery = (type: string) => {
          let q = supabaseAdmin
            .from('campaign_activities')
            .select('id, campaigns!inner(user_id)', { count: 'exact', head: true })
            .eq('campaigns.user_id', userId)
            .eq('activity_type', type);
          if (since) q = q.gte('occurred_at', since);
          if (until) q = q.lt('occurred_at', until);
          return q;
        };
        const [sentRes, openedRes, clickedRes, repliedRes] = await Promise.all(
          ['sent', 'opened', 'clicked', 'replied'].map(makeCountQuery),
        );
        const sent = sentRes.count || 0;
        return {
          sent,
          contacts: sent,
          opened: Math.min(openedRes.count || 0, sent),
          clicked: Math.min(clickedRes.count || 0, sent),
          replied: Math.min(repliedRes.count || 0, sent),
        };
      };

      [cur, prev] = await Promise.all([
        summarise(win?.since ?? null, null),
        win ? summarise(win.prevSince, win.prevUntil) : Promise.resolve({ ...empty }),
      ]);
    }

    const { count: suppressedCount } = await supabaseAdmin
      .from('suppression_list')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    /*
     * Counted, not fetched. These read every contact row and counted them in
     * JS, and PostgREST hands back at most 1,000 rows to a plain select - so
     * past 1,000 contacts the verified and bounced figures, and the average
     * score, silently described only the first thousand.
     */
    const contactCount = (build: (q: any) => any) =>
      build(supabaseAdmin.from('contacts').select('id', { count: 'exact', head: true }).eq('user_id', userId))
        .then(({ count }: { count: number | null }) => count || 0);
    const [verifiedContacts, bouncedContacts, scoreRows] = await Promise.all([
      contactCount((q) => q.gte('dcs_score', 60)),
      contactCount((q) => q.eq('is_bounced', true)),
      fetchAllRows<{ dcs_score: number }>((from, to) =>
        supabaseAdmin.from('contacts').select('dcs_score').eq('user_id', userId)
          .not('dcs_score', 'is', null).order('id').range(from, to)),
    ]);
    const dcsScores = scoreRows.map((c) => Number(c.dcs_score)).filter((n) => Number.isFinite(n));
    const avgDcsScore = dcsScores.length > 0
      ? Math.round(dcsScores.reduce((a, b) => a + b, 0) / dcsScores.length)
      : 0;

    return {
      total_campaigns: totalCampaigns || 0,
      active_campaigns: activeCampaigns || 0,
      total_contacts: totalContacts || 0,
      total_sent: cur.sent,
      // The people those emails reached: the denominator of every rate.
      contacts_sent: cur.contacts,
      total_opened: cur.opened,
      total_clicked: cur.clicked,
      total_replied: cur.replied,
      avg_open_rate: calcRate(cur.opened, cur.contacts),
      avg_click_rate: calcRate(cur.clicked, cur.contacts),
      avg_reply_rate: calcRate(cur.replied, cur.contacts),
      suppressed_count: suppressedCount || 0,
      avg_dcs_score: avgDcsScore,
      verified_contacts: verifiedContacts,
      bounced_contacts: bouncedContacts,
      // Change in the COUNT against the previous period of the same length.
      sent_change: days ? calcChange(cur.sent, prev.sent) : null,
      opened_change: days ? calcChange(cur.opened, prev.opened) : null,
      clicked_change: days ? calcChange(cur.clicked, prev.clicked) : null,
      replied_change: days ? calcChange(cur.replied, prev.replied) : null,
      // Change in the RATE, relative (a 10% -> 12% open rate is +20%). A
      // rate cell shows these: the count changes above mostly say how much
      // more was sent, and beside a percentage read as the rate moving.
      open_rate_change: days ? rateChange(cur.opened, cur.contacts, prev.opened, prev.contacts) : null,
      click_rate_change: days ? rateChange(cur.clicked, cur.contacts, prev.clicked, prev.contacts) : null,
      reply_rate_change: days ? rateChange(cur.replied, cur.contacts, prev.replied, prev.contacts) : null,
    };
  },

  async deliverability(userId: string) {
    // Exact counts for the same reason as overview(): a plain select stops
    // at 1,000 rows, and these bands used to be counted from one.
    const count = (table: string, build: (q: any) => any) =>
      build(supabaseAdmin.from(table).select('id', { count: 'exact', head: true }).eq('user_id', userId))
        .then(({ count: n }: { count: number | null }) => n || 0);
    const [high, medium, low, unscored, bounced, ...reasons] = await Promise.all([
      count('contacts', (q) => q.gte('dcs_score', 80)),
      count('contacts', (q) => q.gte('dcs_score', 50).lt('dcs_score', 80)),
      count('contacts', (q) => q.lt('dcs_score', 50)),
      count('contacts', (q) => q.is('dcs_score', null)),
      count('contacts', (q) => q.eq('is_bounced', true)),
      ...(['unsubscribed', 'bounced', 'complained', 'manual'] as const).map((reason) =>
        count('suppression_list', (q) => q.eq('reason', reason))),
    ]);
    const reasonCounts = { unsubscribed: reasons[0], bounced: reasons[1], complained: reasons[2], manual: reasons[3] };

    return {
      // The app's pigment palette (moss, ochre, brick, graphite, ink), so these
      // charts match the status colours everywhere else.
      dcs_distribution: [
        { label: 'High (≥80)', value: high, color: '#3F8763' },
        { label: 'Medium (50–79)', value: medium, color: '#B88124' },
        { label: 'Low (<50)', value: low, color: '#BE4A3B' },
        { label: 'Unscored', value: unscored, color: '#9A9BA3' },
      ],
      bounced_contacts: bounced,
      suppression_by_reason: [
        { label: 'Unsubscribed', value: reasonCounts.unsubscribed, color: '#3B4AA3' },
        { label: 'Bounced', value: reasonCounts.bounced, color: '#BE4A3B' },
        { label: 'Complained', value: reasonCounts.complained, color: '#B88124' },
        { label: 'Manual', value: reasonCounts.manual, color: '#9A9BA3' },
      ],
    };
  },

  async trend(userId: string, days: number = 30) {
    const { data: campaigns } = await supabaseAdmin
      .from('campaigns')
      .select('id')
      .eq('user_id', userId);

    const campaignIds = (campaigns || []).map((c: any) => c.id);
    if (campaignIds.length === 0) return [];

    const activities = await fetchAllRows<{ activity_type: string; occurred_at: string; campaign_contact_id: string }>((from, to) =>
      supabaseAdmin
        .from('campaign_activities')
        .select('activity_type, occurred_at, campaign_contact_id, campaigns!inner(user_id)')
        .eq('campaigns.user_id', userId)
        .in('activity_type', ['sent', 'opened', 'clicked', 'replied'])
        .gte('occurred_at', utcDayStart(days - 1).toISOString())
        .order('occurred_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
    );

    return bucketByDay(activities, days, ['sent', 'opened', 'clicked', 'replied']);
  },

  async campaign(userId: string, campaignId: string) {
    const { data: campaign } = await supabaseAdmin
      .from('campaigns')
      .select('id')
      .eq('id', campaignId)
      .eq('user_id', userId)
      .single();

    if (!campaign) throw new AppError('Campaign not found', 404);

    const { count: totalContacts } = await supabaseAdmin
      .from('campaign_contacts')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaignId);

    const activities = await fetchAllRows<{ activity_type: string; campaign_contact_id: string }>((from, to) =>
      supabaseAdmin
        .from('campaign_activities')
        .select('activity_type, campaign_contact_id')
        .eq('campaign_id', campaignId)
        .in('activity_type', ['sent', 'opened', 'clicked', 'replied', 'bounced', 'error'])
        .order('id', { ascending: true })
        .range(from, to)
    );

    // Sent is emails; opened/clicked/replied/bounced are people, and every
    // rate is over the people reached (bounces over everyone a send was
    // attempted to, so a refusal at send time counts).
    const people = rollupPeople(activities);
    const errors = activities.filter((a) => a.activity_type === 'error').length;

    return {
      campaign_id: campaignId,
      total_contacts: totalContacts || 0,
      sent: people.sent,
      contacts_reached: people.reached,
      contacts_attempted: people.attempted,
      opened: people.opened,
      clicked: people.clicked,
      replied: people.replied,
      bounced: people.bounced,
      errors,
      open_rate: calcRate(people.opened, people.reached),
      click_rate: calcRate(people.clicked, people.reached),
      reply_rate: calcRate(people.replied, people.reached),
      bounce_rate: calcRate(people.bounced, people.attempted),
    };
  },

  async campaignContacts(userId: string, campaignId: string) {
    const { data: campaign } = await supabaseAdmin
      .from('campaigns')
      .select('id')
      .eq('id', campaignId)
      .eq('user_id', userId)
      .single();

    if (!campaign) throw new AppError('Campaign not found', 404);

    const campaignContacts = await fetchAllRows<any>((from, to) =>
      supabaseAdmin
        .from('campaign_contacts')
        .select('contact_id, status, contacts(email, first_name, last_name, dcs_score, is_bounced)')
        .eq('campaign_id', campaignId)
        .order('id', { ascending: true })
        .range(from, to)
    );

    const allActivities = await fetchAllRows<{ contact_id: string; activity_type: string }>((from, to) =>
      supabaseAdmin
        .from('campaign_activities')
        .select('contact_id, activity_type')
        .eq('campaign_id', campaignId)
        .order('id', { ascending: true })
        .range(from, to)
    );

    const activityByContact = new Map<string, { sent: number; opened: number; clicked: number; replied: boolean }>();
    for (const a of allActivities) {
      if (!activityByContact.has(a.contact_id)) {
        activityByContact.set(a.contact_id, { sent: 0, opened: 0, clicked: 0, replied: false });
      }
      const c = activityByContact.get(a.contact_id)!;
      switch (a.activity_type) {
        case 'sent': c.sent++; break;
        case 'opened': c.opened++; break;
        case 'clicked': c.clicked++; break;
        case 'replied': c.replied = true; break;
      }
    }

    const contacts = campaignContacts.map((cc: any) => {
      const counts = activityByContact.get(cc.contact_id) || { sent: 0, opened: 0, clicked: 0, replied: false };
      return {
        contact_id: cc.contact_id,
        email: cc.contacts?.email || '',
        first_name: cc.contacts?.first_name || null,
        last_name: cc.contacts?.last_name || null,
        dcs_score: cc.contacts?.dcs_score ?? null,
        is_bounced: cc.contacts?.is_bounced ?? false,
        status: cc.status,
        ...counts,
      };
    });

    return { contacts };
  },

  async exportCampaignReport(userId: string, campaignId: string): Promise<string> {
    const stats = await this.campaign(userId, campaignId);
    const { contacts } = await this.campaignContacts(userId, campaignId);

    const { data: campaignData } = await supabaseAdmin
      .from('campaigns')
      .select('name')
      .eq('id', campaignId)
      .eq('user_id', userId)
      .single();

    const campaignName = campaignData?.name || 'Unknown';

    const lines: string[] = [];
    lines.push(`Campaign Report: ${campaignName.replace(/[\n\r]/g, ' ')}`);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');
    lines.push('Summary');
    lines.push(`Total Contacts,${stats.total_contacts}`);
    lines.push(`Sent (emails),${stats.sent}`);
    lines.push(`Contacts reached,${stats.contacts_reached}`);
    lines.push(`Opened (contacts),${stats.opened},${stats.open_rate}%`);
    lines.push(`Clicked (contacts),${stats.clicked},${stats.click_rate}%`);
    lines.push(`Replied (contacts),${stats.replied},${stats.reply_rate}%`);
    lines.push(`Bounced (contacts),${stats.bounced},${stats.bounce_rate}%`);
    lines.push(`Errors,${stats.errors}`);
    lines.push('');
    lines.push('Contact Breakdown');
    lines.push('Email,Name,Status,DCS,Sent,Opened,Clicked,Replied,Bounced');
    for (const c of contacts) {
      const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || '';
      // Neutralise spreadsheet formulas (=, +, -, @) in imported text.
      const csvSafe = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;
      const csvEmail = csvSafe(String(c.email ?? ''));
      const csvName = csvSafe(name);
      lines.push(`${csvEmail},${csvName},${c.status},${c.dcs_score ?? ''},${c.sent},${c.opened},${c.clicked},${c.replied ? 'Yes' : 'No'},${c.is_bounced ? 'Yes' : 'No'}`);
    }

    return lines.join('\n');
  },

  async exportOverviewReport(userId: string, days?: number): Promise<string> {
    const overview = await this.overview(userId, days);
    const { data: campaigns } = await supabaseAdmin
      .from('campaigns')
      .select('id, name, status, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    const lines: string[] = [];
    lines.push(`Overview Report`);
    lines.push(`Generated: ${new Date().toISOString()}`);
    if (days) lines.push(`Period: Last ${days} days`);
    lines.push('');
    lines.push('Overview');
    lines.push(`Total Campaigns,${overview.total_campaigns}`);
    lines.push(`Active Campaigns,${overview.active_campaigns}`);
    lines.push(`Total Contacts,${overview.total_contacts}`);
    lines.push(`Emails Sent,${overview.total_sent}`);
    lines.push(`Contacts Sent To,${overview.contacts_sent}`);
    lines.push(`Contacts Opened,${overview.total_opened},${overview.avg_open_rate}%`);
    lines.push(`Contacts Clicked,${overview.total_clicked},${overview.avg_click_rate}%`);
    lines.push(`Contacts Replied,${overview.total_replied},${overview.avg_reply_rate}%`);
    lines.push('');
    lines.push('Campaigns');
    lines.push('Name,Status,Created');
    for (const c of campaigns || []) {
      lines.push(`"${String(c.name ?? '').replace(/"/g, '""')}",${c.status},${c.created_at}`);
    }

    return lines.join('\n');
  },

  async contactTimeline(userId: string, contactId: string) {
    const { data: contact } = await supabaseAdmin
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('user_id', userId)
      // maybeSingle, not single: .single() raises on "no rows", which surfaced
      // as a 500 instead of the 404 below.
      .maybeSingle();

    if (!contact) throw new AppError('Contact not found', 404);

    const { data, error } = await supabaseAdmin
      .from('campaign_activities')
      .select('id, activity_type, metadata, occurred_at, campaign_id, step_id, campaigns(name), campaign_steps(subject, step_order)')
      .eq('contact_id', contactId)
      // Scanner and privacy-proxy hits are kept for diagnosis only.
      .not('activity_type', 'in', MACHINE_TYPES)
      .order('occurred_at', { ascending: false })
      .limit(100);

    if (error) throw new AppError(error.message, 500);

    return (data || []).map((a: any) => ({
      id: a.id,
      activity_type: a.activity_type,
      campaign_name: a.campaigns?.name || 'Unknown',
      step_subject: a.campaign_steps?.subject || null,
      // So the timeline can say "step 2 of Q4 brokers" rather than
      // "campaign email sent" for every one of a sequence's emails.
      step_order: typeof a.campaign_steps?.step_order === 'number' ? a.campaign_steps.step_order : null,
      campaign_id: a.campaign_id,
      metadata: a.metadata,
      occurred_at: a.occurred_at,
    }));
  },

  // ─── New deep-dive methods ──────────────────────────────────────────────────

  async campaignList(userId: string) {
    const { data: campaigns } = await supabaseAdmin
      .from('campaigns')
      .select('id, name, status, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (!campaigns || campaigns.length === 0) return [];

    const campaignIds = campaigns.map((c: any) => c.id);

    const activities = await fetchAllRows<{ campaign_id: string; campaign_contact_id: string; activity_type: string }>((from, to) =>
      supabaseAdmin
        .from('campaign_activities')
        .select('campaign_id, campaign_contact_id, activity_type, campaigns!inner(user_id)')
        .eq('campaigns.user_id', userId)
        .in('activity_type', ['sent', 'opened', 'clicked', 'replied', 'bounced'])
        .order('id', { ascending: true })
        .range(from, to)
    );

    const rowsByCampaign = new Map<string, typeof activities>();
    for (const id of campaignIds) rowsByCampaign.set(id, []);
    for (const a of activities) rowsByCampaign.get(a.campaign_id)?.push(a);

    // All time, whatever period the page around it is showing. Sent is
    // emails; the rest are people, with rates over the people reached.
    return campaigns.map((c: any) => {
      const s = rollupPeople(rowsByCampaign.get(c.id) || []);
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        created_at: c.created_at,
        sent: s.sent,
        contacts_sent: s.reached,
        opened: s.opened,
        clicked: s.clicked,
        replied: s.replied,
        bounced: s.bounced,
        open_rate: calcRate(s.opened, s.reached),
        click_rate: calcRate(s.clicked, s.reached),
        reply_rate: calcRate(s.replied, s.reached),
        bounce_rate: calcRate(s.bounced, s.attempted),
      };
    });
  },

  /**
   * What each campaign earned, not just what it sent.
   *
   * The join this product exists to be able to make: replies from
   * campaign_activities, revenue from the deals those replies produced. Both
   * halves are in one database here, which is the whole reason the number can
   * be computed at all - in a two-tool stack the replies and the revenue sit
   * in different companies' systems and nobody ever reconciles them.
   *
   * The arithmetic itself is in shared, so this and any other reader cannot
   * drift into disagreeing about what a won deal was worth.
   */
  async revenue(userId: string) {
    const { data: campaigns } = await supabaseAdmin
      .from('campaigns')
      .select('id, name, status, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (!campaigns || campaigns.length === 0) return [];

    const campaignIds = campaigns.map((c: any) => c.id);

    const activities = await fetchAllRows<{ campaign_id: string; campaign_contact_id: string; activity_type: string }>((from, to) =>
      supabaseAdmin
        .from('campaign_activities')
        .select('campaign_id, campaign_contact_id, activity_type, campaigns!inner(user_id)')
        .eq('campaigns.user_id', userId)
        .in('activity_type', ['sent', 'replied'])
        .order('id', { ascending: true })
        .range(from, to)
    );

    // Only attributed deals matter here, and the filter is on the indexed
    // column rather than pulling every deal and discarding most of them.
    const deals = await fetchAllRows<any>((from, to) =>
      supabaseAdmin
        .from('deals')
        .select('id, stage, value, probability, recurring_amount, recurring_period, one_off_amount, term_months, source_campaign_id, source_step_id, attribution')
        .eq('user_id', userId)
        .not('source_campaign_id', 'is', null)
        .order('id', { ascending: true })
        .range(from, to)
    );

    const revenue = new Map(revenueByCampaign(deals).map((r) => [r.campaignId, r]));

    // Replies are people: value per reply divided by reply messages made a
    // prospect who wrote back three times look like three customers.
    const counts = new Map<string, { sent: number; replied: number }>();
    const repliedPeople = new Set<string>();
    for (const id of campaignIds) counts.set(id, { sent: 0, replied: 0 });
    for (const a of activities) {
      const c = counts.get(a.campaign_id);
      if (!c) continue;
      if (a.activity_type === 'sent') c.sent++;
      else if (a.activity_type === 'replied' && !repliedPeople.has(a.campaign_contact_id)) {
        repliedPeople.add(a.campaign_contact_id);
        c.replied++;
      }
    }

    return campaigns.map((c: any) => {
      const n = counts.get(c.id) || { sent: 0, replied: 0 };
      const r = revenue.get(c.id);
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        created_at: c.created_at,
        sent: n.sent,
        replied: n.replied,
        deals: r?.deals ?? 0,
        won: r?.won ?? 0,
        lost: r?.lost ?? 0,
        open: r?.open ?? 0,
        won_value: r?.wonValue ?? 0,
        strong_won_value: r?.strongWonValue ?? 0,
        weighted_open: r?.weightedOpen ?? 0,
        win_rate: r?.winRate ?? null,
        average_won: r?.averageWon ?? null,
        value_per_reply: valuePerReply(r?.wonValue ?? 0, n.replied),
      };
    });
  },

  /**
   * One campaign, all the way from sent to banked.
   *
   * The list view answers "which sequence made money"; this answers "which
   * part of it did". A sequence is usually carried by one step - the second
   * follow-up, the breakup email - and knowing which one is the difference
   * between rewriting the sequence and rewriting the step that works.
   *
   * Revenue is credited to the step recorded on the deal, which is the step
   * whose message the reply came back to. Deals attributed with no step keep
   * their money in the campaign total and sit under "step not recorded"
   * rather than being silently dropped or arbitrarily assigned to step one.
   */
  async campaignRevenue(userId: string, campaignId: string) {
    const { data: campaign } = await supabaseAdmin
      .from('campaigns')
      .select('id, name, status, created_at')
      .eq('id', campaignId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!campaign) throw new AppError('Campaign not found', 404);

    const { data: steps } = await supabaseAdmin
      .from('campaign_steps')
      .select('id, step_order, step_type, subject')
      .eq('campaign_id', campaignId)
      .order('step_order', { ascending: true });

    const activities = await fetchAllRows<{ activity_type: string; step_id: string | null; campaign_contact_id: string }>((from, to) =>
      supabaseAdmin
        .from('campaign_activities')
        .select('activity_type, step_id, campaign_contact_id')
        .eq('campaign_id', campaignId)
        .in('activity_type', ['sent', 'replied'])
        .order('id', { ascending: true })
        .range(from, to)
    );

    const deals = await fetchAllRows<any>((from, to) =>
      supabaseAdmin
        .from('deals')
        .select('id, title, stage, value, probability, recurring_amount, recurring_period, one_off_amount, term_months, contact_id, contact_name, contact_email, source_campaign_id, source_step_id, attribution, closed_at, created_at')
        .eq('user_id', userId)
        .eq('source_campaign_id', campaignId)
        .order('id', { ascending: true })
        .range(from, to)
    );

    // Sent is emails; replied is people - once for the campaign, and once
    // per step they replied to - and `reached` is the people sent to.
    const totals = { sent: 0, replied: 0, reached: 0 };
    const perStep = new Map<string, { sent: number; replied: number }>();
    const reachedPeople = new Set<string>();
    const repliedPeople = new Set<string>();
    const repliedAtStep = new Set<string>();
    for (const a of activities) {
      if (a.activity_type === 'sent') {
        totals.sent++;
        reachedPeople.add(a.campaign_contact_id);
      } else if (a.activity_type === 'replied') {
        if (repliedPeople.has(a.campaign_contact_id)) {
          // counted already for the campaign; may still be new for its step
        } else {
          repliedPeople.add(a.campaign_contact_id);
          totals.replied++;
        }
      }
      if (!a.step_id) continue;
      const row = perStep.get(a.step_id) ?? { sent: 0, replied: 0 };
      if (a.activity_type === 'sent') row.sent++;
      else if (a.activity_type === 'replied') {
        const key = `${a.step_id}:${a.campaign_contact_id}`;
        if (!repliedAtStep.has(key)) { repliedAtStep.add(key); row.replied++; }
      }
      perStep.set(a.step_id, row);
    }
    totals.reached = reachedPeople.size;

    const rollup = revenueByCampaign(deals)[0];
    const won = deals.filter((d: any) => d.stage === 'won').length;

    // Group the deals by the step credited on each, so the money lands where
    // the reply did rather than on the campaign as an undifferentiated lump.
    const UNRECORDED = '__no_step__';
    const dealsByStep = new Map<string, any[]>();
    for (const d of deals) {
      const key = d.source_step_id || UNRECORDED;
      dealsByStep.set(key, [...(dealsByStep.get(key) ?? []), d]);
    }

    const stepRows = (steps || []).map((st: any) => {
      const counts = perStep.get(st.id) ?? { sent: 0, replied: 0 };
      const stepDeals = dealsByStep.get(st.id) ?? [];
      const r = revenueByCampaign(stepDeals.map((d) => ({ ...d, source_campaign_id: 'x' })))[0];
      return {
        id: st.id,
        step_order: st.step_order,
        step_type: st.step_type,
        subject: st.subject,
        sent: counts.sent,
        replied: counts.replied,
        deals: stepDeals.length,
        won: r?.won ?? 0,
        won_value: r?.wonValue ?? 0,
        value_per_reply: valuePerReply(r?.wonValue ?? 0, counts.replied),
      };
    });

    const orphans = dealsByStep.get(UNRECORDED) ?? [];
    const orphanRollup = orphans.length
      ? revenueByCampaign(orphans.map((d) => ({ ...d, source_campaign_id: 'x' })))[0]
      : null;

    return {
      campaign,
      // People at every stage: reached, replied, became a deal, won.
      funnel: outreachFunnel({
        sent: totals.reached,
        replied: totals.replied,
        deals: deals.length,
        won,
      }),
      totals: {
        sent: totals.sent,
        replied: totals.replied,
        deals: rollup?.deals ?? 0,
        won: rollup?.won ?? 0,
        lost: rollup?.lost ?? 0,
        open: rollup?.open ?? 0,
        won_value: rollup?.wonValue ?? 0,
        strong_won_value: rollup?.strongWonValue ?? 0,
        weighted_open: rollup?.weightedOpen ?? 0,
        win_rate: rollup?.winRate ?? null,
        average_won: rollup?.averageWon ?? null,
        value_per_reply: valuePerReply(rollup?.wonValue ?? 0, totals.replied),
      },
      steps: stepRows,
      unrecorded_step: orphanRollup
        ? { deals: orphans.length, won: orphanRollup.won, won_value: orphanRollup.wonValue }
        : null,
      // The deals themselves, so a number on this page can always be opened
      // and checked rather than being taken on trust.
      deals: deals
        .map((d: any) => ({
          id: d.id, title: d.title, stage: d.stage,
          contact_id: d.contact_id, contact_name: d.contact_name, contact_email: d.contact_email,
          attribution: d.attribution, source_step_id: d.source_step_id,
          value: dealValue(d), closed_at: d.closed_at, created_at: d.created_at,
        }))
        .sort((a: any, b: any) => b.value - a.value),
    };
  },

  async campaignFunnel(userId: string, campaignId: string) {
    const { data: campaign } = await supabaseAdmin
      .from('campaigns')
      .select('id')
      .eq('id', campaignId)
      .eq('user_id', userId)
      .single();

    if (!campaign) throw new AppError('Campaign not found', 404);

    const { data: steps } = await supabaseAdmin
      .from('campaign_steps')
      .select('id, step_order, subject, delay_days')
      .eq('campaign_id', campaignId)
      .order('step_order', { ascending: true });

    const activities = await fetchAllRows<{ contact_id: string; activity_type: string; step_id: string | null }>((from, to) =>
      supabaseAdmin
        .from('campaign_activities')
        .select('contact_id, activity_type, step_id')
        .eq('campaign_id', campaignId)
        .order('id', { ascending: true })
        .range(from, to)
    );

    if (!steps || steps.length === 0) {
      // No steps configured — aggregate across whole campaign
      const byType = new Map<string, Set<string>>();
      for (const a of activities) {
        if (!byType.has(a.activity_type)) byType.set(a.activity_type, new Set());
        byType.get(a.activity_type)!.add(a.contact_id);
      }
      const sent = byType.get('sent')?.size || 0;
      return [{
        step_number: 1,
        step_id: campaignId,
        subject: 'Campaign',
        delay_days: 0,
        sent,
        opened: byType.get('opened')?.size || 0,
        clicked: byType.get('clicked')?.size || 0,
        replied: byType.get('replied')?.size || 0,
        bounced: byType.get('bounced')?.size || 0,
        open_rate: calcRate(byType.get('opened')?.size || 0, sent),
        click_rate: calcRate(byType.get('clicked')?.size || 0, sent),
        reply_rate: calcRate(byType.get('replied')?.size || 0, sent),
        bounce_rate: calcRate(byType.get('bounced')?.size || 0, sent),
      }];
    }

    // Per-step aggregation using Sets for unique contact counts
    type StepCounts = { sent: Set<string>; opened: Set<string>; clicked: Set<string>; replied: Set<string>; bounced: Set<string> };
    const stepStats = new Map<string, StepCounts>();
    for (const step of steps) {
      stepStats.set(step.id, { sent: new Set(), opened: new Set(), clicked: new Set(), replied: new Set(), bounced: new Set() });
    }

    for (const a of activities) {
      if (!a.step_id) continue;
      const s = stepStats.get(a.step_id);
      if (!s) continue;
      switch (a.activity_type) {
        case 'sent': s.sent.add(a.contact_id); break;
        case 'opened': s.opened.add(a.contact_id); break;
        case 'clicked': s.clicked.add(a.contact_id); break;
        case 'replied': s.replied.add(a.contact_id); break;
        case 'bounced': s.bounced.add(a.contact_id); break;
      }
    }

    return steps.map((step: any) => {
      const s = stepStats.get(step.id);
      const sent = s?.sent.size || 0;
      return {
        step_number: step.step_order,
        step_id: step.id,
        subject: step.subject || `Step ${step.step_order}`,
        delay_days: step.delay_days || 0,
        sent,
        opened: s?.opened.size || 0,
        clicked: s?.clicked.size || 0,
        replied: s?.replied.size || 0,
        bounced: s?.bounced.size || 0,
        open_rate: calcRate(s?.opened.size || 0, sent),
        click_rate: calcRate(s?.clicked.size || 0, sent),
        reply_rate: calcRate(s?.replied.size || 0, sent),
        bounce_rate: calcRate(s?.bounced.size || 0, sent),
      };
    });
  },

  async campaignAbTest(userId: string, campaignId: string) {
    const { data: campaign } = await supabaseAdmin
      .from('campaigns')
      .select('id')
      .eq('id', campaignId)
      .eq('user_id', userId)
      .single();

    if (!campaign) throw new AppError('Campaign not found', 404);

    const { data: steps } = await supabaseAdmin
      .from('campaign_steps')
      .select('id, step_order, subject, subject_b, body_html_b, delay_days')
      .eq('campaign_id', campaignId)
      .or('subject_b.not.is.null,body_html_b.not.is.null');

    if (!steps || steps.length === 0) return { has_ab_test: false, steps: [] };

    const stepIds = steps.map((s: any) => s.id);

    const allActivities = await fetchAllRows<{ contact_id: string; step_id: string; activity_type: string; metadata: any }>((from, to) =>
      supabaseAdmin
        .from('campaign_activities')
        .select('contact_id, step_id, activity_type, metadata')
        .eq('campaign_id', campaignId)
        .in('step_id', stepIds)
        .order('id', { ascending: true })
        .range(from, to)
    );

    /*
     * Which arm each send was in — and nothing at all for sends that were
     * not in the experiment.
     *
     * This read `ab_variant === 'b' ? 'b' : 'a'`, which cannot return
     * nothing, so every send without a variant was counted as A. Two
     * groups land there: everything sent before the test was added to the
     * step, and — until the sender was fixed alongside this — every send
     * of a body-only test.
     *
     * Neither was randomised. Folding them into A does not merely add
     * noise, it puts a non-randomised group into one arm, which is the
     * failure that invalidates an experiment rather than weakening it. A
     * body-only test came out as variant A with all the volume beside
     * variant B with none, over sends that were half B.
     */
    const variantByContactStep = new Map<string, 'a' | 'b'>();
    const untrackedByStep = new Map<string, number>();
    for (const a of allActivities) {
      if (a.activity_type !== 'sent') continue;
      const variant = readVariant(a.metadata);
      if (!variant) {
        untrackedByStep.set(a.step_id, (untrackedByStep.get(a.step_id) || 0) + 1);
        continue;
      }
      variantByContactStep.set(`${a.contact_id}:${a.step_id}`, variant);
    }

    const result = steps.map((step: any) => {
      const stats: Record<'a' | 'b', { sent: number; opened: number; clicked: number; replied: number }> = {
        a: { sent: 0, opened: 0, clicked: 0, replied: 0 },
        b: { sent: 0, opened: 0, clicked: 0, replied: 0 },
      };

      const repliedInArm = new Set<string>();
      for (const a of allActivities) {
        if (a.step_id !== step.id) continue;
        const variant = variantByContactStep.get(`${a.contact_id}:${a.step_id}`);
        if (!variant) continue;

        switch (a.activity_type) {
          case 'sent': stats[variant].sent++; break;
          case 'opened': stats[variant].opened++; break;
          case 'clicked': stats[variant].clicked++; break;
          // One reply per person per arm: a second message from the same
          // prospect is not a second reply.
          case 'replied': {
            const key = `${variant}:${a.contact_id}`;
            if (repliedInArm.has(key)) break;
            repliedInArm.add(key);
            stats[variant].replied++;
            break;
          }
        }
      }

      const aOpenRate = calcRate(stats.a.opened, stats.a.sent);
      const bOpenRate = calcRate(stats.b.opened, stats.b.sent);
      const aClickRate = calcRate(stats.a.clicked, stats.a.sent);
      const bClickRate = calcRate(stats.b.clicked, stats.b.sent);
      const aReplyRate = calcRate(stats.a.replied, stats.a.sent);
      const bReplyRate = calcRate(stats.b.replied, stats.b.sent);

      const minSent = Math.min(stats.a.sent, stats.b.sent);
      const hasEnoughData = minSent >= MIN_AB_SAMPLE;
      // Opens, because the subject line is what a subject-line test moves.
      const pValue = twoProportionPValue(stats.a.opened, stats.a.sent, stats.b.opened, stats.b.sent);
      const significant = hasEnoughData && pValue !== null && pValue < AB_ALPHA;

      // `leading` is the one that's ahead; `winner` is the one you should act
      // on. Keeping them apart is the difference between "B is up so far" and
      // "B is up and the gap is unlikely to be chance" — the first is worth
      // showing, only the second is worth rewriting a sequence over.
      const leading: 'a' | 'b' | null =
        bOpenRate === aOpenRate ? null : bOpenRate > aOpenRate ? 'b' : 'a';
      const winner: 'a' | 'b' | null = significant ? leading : null;

      return {
        step_number: step.step_order,
        step_id: step.id,
        subject_a: step.subject || `Step ${step.step_order}`,
        subject_b: step.subject_b || `Step ${step.step_order} – Variant B`,
        variant_a: { ...stats.a, open_rate: aOpenRate, click_rate: aClickRate, reply_rate: aReplyRate },
        variant_b: { ...stats.b, open_rate: bOpenRate, click_rate: bClickRate, reply_rate: bReplyRate },
        winner,
        leading,
        significant,
        p_value: pValue,
        has_enough_data: hasEnoughData,
        min_sample: MIN_AB_SAMPLE,
        /*
         * Sends at this step that were never part of the test. Reported
         * rather than dropped silently, because "400 sent" on the campaign
         * beside "120 in the test" is a discrepancy somebody will notice
         * and mistrust the whole panel over.
         */
        untracked_sent: untrackedByStep.get(step.id) || 0,
      };
    });

    return { has_ab_test: result.length > 0, steps: result };
  },

  async campaignTrend(userId: string, campaignId: string, days: number = 30) {
    const { data: campaign } = await supabaseAdmin
      .from('campaigns')
      .select('id')
      .eq('id', campaignId)
      .eq('user_id', userId)
      .single();

    if (!campaign) throw new AppError('Campaign not found', 404);

    const activities = await fetchAllRows<{ activity_type: string; occurred_at: string; campaign_contact_id: string }>((from, to) =>
      supabaseAdmin
        .from('campaign_activities')
        .select('activity_type, occurred_at, campaign_contact_id')
        .eq('campaign_id', campaignId)
        .in('activity_type', ['sent', 'opened', 'clicked', 'replied', 'bounced'])
        .gte('occurred_at', utcDayStart(days - 1).toISOString())
        .order('occurred_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
    );

    return bucketByDay(activities, days, ['sent', 'opened', 'clicked', 'replied', 'bounced']);
  },

  async campaignHeatmap(userId: string, campaignId: string) {
    const { data: campaign } = await supabaseAdmin
      .from('campaigns')
      .select('id')
      .eq('id', campaignId)
      .eq('user_id', userId)
      .single();

    if (!campaign) throw new AppError('Campaign not found', 404);

    const activities = await fetchAllRows<{ activity_type: string; occurred_at: string }>((from, to) =>
      supabaseAdmin
        .from('campaign_activities')
        .select('activity_type, occurred_at')
        .eq('campaign_id', campaignId)
        .in('activity_type', ['opened', 'clicked', 'replied'])
        .order('id', { ascending: true })
        .range(from, to)
    );

    // 7 days × 24 hours engagement grid
    const grid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
    for (const a of activities) {
      if (!a.occurred_at) continue;
      const d = new Date(a.occurred_at);
      grid[d.getUTCDay()][d.getUTCHours()]++;
    }

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const maxValue = Math.max(1, ...grid.flat());
    return {
      grid: grid.map((row, i) => ({ day: days[i], hours: row })),
      max_value: maxValue,
    };
  },

  /**
   * Which step earns the replies — and which one to stop sending.
   *
   * campaignFunnel() already reports what happened at each step. What it
   * cannot do is answer whether a step is worth keeping, and the numbers on
   * it quietly argue the wrong way: a follow-up's reply rate is measured over
   * the survivors, so the pool shrinks at every step and the rate flatters
   * whatever comes last. Two replies out of eighteen reads as 11% and looks
   * like the strongest step in the sequence.
   *
   * So this reports share of the campaign's total replies, which does not
   * shrink with the pool, alongside a Wilson interval on the rate — and only
   * calls a step unproductive when even the optimistic end of that interval
   * is well below what the campaign manages elsewhere.
   */
  async sequencePerformance(userId: string, campaignId: string): Promise<SequencePerformance> {
    const { data: campaign } = await supabaseAdmin
      .from('campaigns')
      .select('id')
      .eq('id', campaignId)
      .eq('user_id', userId)
      .single();

    if (!campaign) throw new AppError('Campaign not found', 404);

    const { data: stepRows } = await supabaseAdmin
      .from('campaign_steps')
      .select('id, step_order, subject, delay_days, step_type')
      .eq('campaign_id', campaignId)
      .order('step_order', { ascending: true });

    // Only email steps send anything, so only they can earn a reply. A
    // LinkedIn or wait step sitting in the list with zero sends would
    // otherwise be reported as the worst performer in the sequence.
    const steps = (stepRows || []).filter((s: any) => !s.step_type || s.step_type === 'email');
    if (steps.length === 0) {
      return { total_sent: 0, total_replied: 0, steps: [], recommended_length: null, headline: 'No email steps in this sequence yet.' };
    }

    const activities = await fetchAllRows<{
      contact_id: string; step_id: string | null; activity_type: string; occurred_at: string;
    }>((from, to) =>
      supabaseAdmin
        .from('campaign_activities')
        .select('contact_id, step_id, activity_type, occurred_at')
        .eq('campaign_id', campaignId)
        .order('id', { ascending: true })
        .range(from, to)
    );

    type Bucket = {
      sent: Set<string>; opened: Set<string>; clicked: Set<string>;
      replied: Set<string>; bounced: Set<string>; unsubscribed: Set<string>;
      /** When each contact was sent this step, for the reply-latency median. */
      sentAt: Map<string, number>;
      replyGaps: number[];
    };
    const buckets = new Map<string, Bucket>();
    for (const step of steps) {
      buckets.set(step.id, {
        sent: new Set(), opened: new Set(), clicked: new Set(),
        replied: new Set(), bounced: new Set(), unsubscribed: new Set(),
        sentAt: new Map(), replyGaps: [],
      });
    }

    // Sends first, so a reply always has a send to measure back to regardless
    // of the order rows come out of the table.
    for (const a of activities) {
      if (a.activity_type !== 'sent' || !a.step_id) continue;
      const b = buckets.get(a.step_id);
      if (!b) continue;
      b.sent.add(a.contact_id);
      const at = Date.parse(a.occurred_at || '');
      if (Number.isFinite(at)) {
        const prior = b.sentAt.get(a.contact_id);
        if (prior === undefined || at < prior) b.sentAt.set(a.contact_id, at);
      }
    }

    for (const a of activities) {
      if (!a.step_id) continue;
      const b = buckets.get(a.step_id);
      if (!b) continue;
      switch (a.activity_type) {
        case 'opened': b.opened.add(a.contact_id); break;
        case 'clicked': b.clicked.add(a.contact_id); break;
        case 'bounced': b.bounced.add(a.contact_id); break;
        case 'unsubscribed': b.unsubscribed.add(a.contact_id); break;
        case 'replied': {
          // 'auto_reply' is a separate type by design, so out-of-office is
          // already excluded here rather than by remembering to exclude it.
          if (b.replied.has(a.contact_id)) break;
          b.replied.add(a.contact_id);
          const sentAt = b.sentAt.get(a.contact_id);
          const at = Date.parse(a.occurred_at || '');
          if (sentAt !== undefined && Number.isFinite(at) && at >= sentAt) {
            b.replyGaps.push((at - sentAt) / 3_600_000);
          }
          break;
        }
      }
    }

    const totalSent = steps.reduce((n, s) => n + (buckets.get(s.id)?.sent.size || 0), 0);
    const totalReplied = steps.reduce((n, s) => n + (buckets.get(s.id)?.replied.size || 0), 0);
    const overallRate = totalSent > 0 ? totalReplied / totalSent : 0;
    // A step is judged against what the campaign itself achieves, not an
    // invented benchmark: a 0.4% reply rate is poor in one market and normal
    // in another, and the sequence's own numbers are the only fair comparison.
    const floor = overallRate / 4;

    const performance: SequenceStepPerformance[] = steps.map((step: any) => {
      const b = buckets.get(step.id)!;
      const sent = b.sent.size;
      const replied = b.replied.size;
      const rate = sent > 0 ? replied / sent : 0;
      const lower = wilsonLowerBound(replied, sent);
      const upper = wilsonUpperBound(replied, sent);
      const share = totalReplied > 0 ? replied / totalReplied : 0;

      let verdict: StepVerdict;
      let note: string;
      if (sent < MIN_STEP_SENDS) {
        verdict = 'too_early';
        note = sent === 0
          ? 'Nothing sent from this step yet.'
          : `Only ${sent} sent — ${MIN_STEP_SENDS} needed before the numbers mean anything.`;
      } else if (upper < floor) {
        verdict = 'unproductive';
        note = replied === 0
          ? `${sent.toLocaleString()} emails, no replies. Even the optimistic reading puts this step below ${(upper * 100).toFixed(1)}%, against ${(overallRate * 100).toFixed(1)}% for the campaign.`
          : `${replied} ${replied === 1 ? 'reply' : 'replies'} from ${sent.toLocaleString()} emails — confidently behind the ${(overallRate * 100).toFixed(1)}% this campaign manages elsewhere.`;
      } else if (lower >= floor) {
        verdict = 'earning';
        note = `${replied} ${replied === 1 ? 'reply' : 'replies'}, ${(share * 100).toFixed(0)}% of everything this campaign has earned.`;
      } else {
        verdict = 'marginal';
        note = `${replied} ${replied === 1 ? 'reply' : 'replies'} from ${sent.toLocaleString()} emails. Real, but the sample is still too thin to call it either way.`;
      }

      return {
        step_id: step.id,
        step_number: step.step_order,
        subject: step.subject || `Step ${step.step_order}`,
        delay_days: step.delay_days || 0,
        sent,
        opened: b.opened.size,
        clicked: b.clicked.size,
        replied,
        bounced: b.bounced.size,
        unsubscribed: b.unsubscribed.size,
        share_of_replies: share,
        reply_rate: rate,
        confident_reply_rate: lower,
        replies_per_100: sent > 0 ? (replied / sent) * 100 : 0,
        median_hours_to_reply: median(b.replyGaps),
        verdict,
        note,
      };
    });

    return {
      total_sent: totalSent,
      total_replied: totalReplied,
      steps: performance,
      ...summariseSequence(performance, totalReplied),
    };
  },
};

/** Middle value, or null when there is nothing to take the middle of. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(value * 10) / 10;
}

/**
 * Where the sequence stops earning, and one sentence about it.
 *
 * Only the *trailing* run of unproductive steps is worth trimming: a weak
 * step three followed by a strong step four is not a reason to delete step
 * four, and telling someone to cut the sequence in the middle would be
 * advice that costs them replies.
 */
function summariseSequence(
  steps: SequenceStepPerformance[],
  totalReplied: number,
): { recommended_length: number | null; headline: string } {
  if (steps.every((s) => s.verdict === 'too_early')) {
    return {
      recommended_length: null,
      headline: 'Not enough sends yet to tell which step is doing the work.',
    };
  }

  let cut = steps.length;
  while (cut > 0 && steps[cut - 1].verdict === 'unproductive') cut--;
  const trailing = steps.slice(cut);

  if (trailing.length > 0 && cut > 0) {
    const wasted = trailing.reduce((n, s) => n + s.sent, 0);
    const earned = trailing.reduce((n, s) => n + s.replied, 0);
    return {
      recommended_length: steps[cut - 1].step_number,
      headline:
        `${trailing.length === 1 ? `Step ${trailing[0].step_number} has` : `Steps ${trailing[0].step_number}-${trailing[trailing.length - 1].step_number} have`} ` +
        `sent ${wasted.toLocaleString()} emails for ${earned === 0 ? 'no replies' : `${earned} ${earned === 1 ? 'reply' : 'replies'}`}. ` +
        `The sequence has done its work by step ${steps[cut - 1].step_number}.`,
    };
  }

  const best = steps.reduce((top, s) => (s.share_of_replies > top.share_of_replies ? s : top), steps[0]);
  if (totalReplied > 0 && best.share_of_replies >= 0.4) {
    return {
      recommended_length: steps.length,
      headline: `Step ${best.step_number} earns ${(best.share_of_replies * 100).toFixed(0)}% of your replies. Every step is pulling its weight.`,
    };
  }
  if (totalReplied === 0) {
    return {
      recommended_length: steps.length,
      headline: 'No replies from any step yet — there is nothing here to trim, only copy to change.',
    };
  }
  return {
    recommended_length: steps.length,
    headline: 'Replies are spread across the sequence — no step is carrying it, and none is dead weight.',
  };
}

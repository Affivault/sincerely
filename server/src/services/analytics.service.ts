import { supabaseAdmin } from '../config/supabase.js';
import { twoProportionPValue, wilsonLowerBound, wilsonUpperBound } from '../utils/stats.js';
import { AppError } from '../middleware/error.middleware.js';
import { MIN_STEP_SENDS, revenueByCampaign, valuePerReply } from '@lemlist/shared';
import type { SequencePerformance, SequenceStepPerformance, StepVerdict } from '@lemlist/shared';

function calcRate(value: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((value / total) * 100 * 10) / 10;
}

function calcChange(current: number, prev: number): number | null {
  if (prev === 0) return current > 0 ? 100 : null;
  return Math.round(((current - prev) / prev) * 1000) / 10;
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
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

    let totalSent = 0, totalOpened = 0, totalClicked = 0, totalReplied = 0;
    let prevSent = 0, prevOpened = 0, prevClicked = 0, prevReplied = 0;

    if (campaignIds.length > 0) {
      const sinceFilter = days ? daysAgoISO(days) : null;

      const makeCountQuery = (type: string, since?: string | null, until?: string | null) => {
        let q = supabaseAdmin
          .from('campaign_activities')
          .select('*', { count: 'exact', head: true })
          .in('campaign_id', campaignIds)
          .eq('activity_type', type);
        if (since) q = q.gte('occurred_at', since);
        if (until) q = q.lt('occurred_at', until);
        return q;
      };

      const [sentRes, openedRes, clickedRes, repliedRes] = await Promise.all([
        makeCountQuery('sent', sinceFilter),
        makeCountQuery('opened', sinceFilter),
        makeCountQuery('clicked', sinceFilter),
        makeCountQuery('replied', sinceFilter),
      ]);

      totalSent = sentRes.count || 0;
      totalOpened = openedRes.count || 0;
      totalClicked = clickedRes.count || 0;
      totalReplied = repliedRes.count || 0;

      if (days) {
        const prevSince = daysAgoISO(days * 2);
        const prevUntil = daysAgoISO(days);
        const [pSent, pOpened, pClicked, pReplied] = await Promise.all([
          makeCountQuery('sent', prevSince, prevUntil),
          makeCountQuery('opened', prevSince, prevUntil),
          makeCountQuery('clicked', prevSince, prevUntil),
          makeCountQuery('replied', prevSince, prevUntil),
        ]);
        prevSent = pSent.count || 0;
        prevOpened = pOpened.count || 0;
        prevClicked = pClicked.count || 0;
        prevReplied = pReplied.count || 0;
      }
    }

    const { count: suppressedCount } = await supabaseAdmin
      .from('suppression_list')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    const { data: contactMetrics } = await supabaseAdmin
      .from('contacts')
      .select('dcs_score, is_bounced')
      .eq('user_id', userId);

    const dcsScores = (contactMetrics || [])
      .map((c: any) => c.dcs_score)
      .filter((s: any) => s !== null && s !== undefined && Number.isFinite(Number(s)));
    const avgDcsScore = dcsScores.length > 0
      ? Math.round(dcsScores.reduce((a: number, b: number) => a + Number(b), 0) / dcsScores.length)
      : 0;
    const verifiedContacts = (contactMetrics || []).filter((c: any) => Number(c.dcs_score) >= 60).length;
    const bouncedContacts = (contactMetrics || []).filter((c: any) => c.is_bounced).length;

    return {
      total_campaigns: totalCampaigns || 0,
      active_campaigns: activeCampaigns || 0,
      total_contacts: totalContacts || 0,
      total_sent: totalSent,
      total_opened: totalOpened,
      total_clicked: totalClicked,
      total_replied: totalReplied,
      avg_open_rate: calcRate(totalOpened, totalSent),
      avg_click_rate: calcRate(totalClicked, totalSent),
      avg_reply_rate: calcRate(totalReplied, totalSent),
      suppressed_count: suppressedCount || 0,
      avg_dcs_score: avgDcsScore,
      verified_contacts: verifiedContacts,
      bounced_contacts: bouncedContacts,
      sent_change: days ? calcChange(totalSent, prevSent) : null,
      opened_change: days ? calcChange(totalOpened, prevOpened) : null,
      clicked_change: days ? calcChange(totalClicked, prevClicked) : null,
      replied_change: days ? calcChange(totalReplied, prevReplied) : null,
    };
  },

  async deliverability(userId: string) {
    const { data: contacts } = await supabaseAdmin
      .from('contacts')
      .select('dcs_score, is_bounced')
      .eq('user_id', userId);

    const list = contacts || [];
    const high = list.filter((c: any) => Number(c.dcs_score) >= 80).length;
    const medium = list.filter((c: any) => Number(c.dcs_score) >= 50 && Number(c.dcs_score) < 80).length;
    const low = list.filter((c: any) => c.dcs_score !== null && Number(c.dcs_score) < 50).length;
    const unscored = list.filter((c: any) => c.dcs_score === null || c.dcs_score === undefined).length;
    const bounced = list.filter((c: any) => c.is_bounced).length;

    const { data: suppressionRows } = await supabaseAdmin
      .from('suppression_list')
      .select('reason')
      .eq('user_id', userId);

    const reasonCounts: Record<string, number> = { unsubscribed: 0, bounced: 0, complained: 0, manual: 0 };
    for (const row of suppressionRows || []) {
      if (row.reason in reasonCounts) reasonCounts[row.reason]++;
    }

    return {
      dcs_distribution: [
        { label: 'High (≥80)', value: high, color: '#10B981' },
        { label: 'Medium (50–79)', value: medium, color: '#F59E0B' },
        { label: 'Low (<50)', value: low, color: '#EF4444' },
        { label: 'Unscored', value: unscored, color: '#94A3B8' },
      ],
      bounced_contacts: bounced,
      suppression_by_reason: [
        { label: 'Unsubscribed', value: reasonCounts.unsubscribed, color: '#6366F1' },
        { label: 'Bounced', value: reasonCounts.bounced, color: '#EF4444' },
        { label: 'Complained', value: reasonCounts.complained, color: '#F59E0B' },
        { label: 'Manual', value: reasonCounts.manual, color: '#94A3B8' },
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

    const activities = await fetchAllRows<{ activity_type: string; occurred_at: string }>((from, to) =>
      supabaseAdmin
        .from('campaign_activities')
        .select('activity_type, occurred_at')
        .in('campaign_id', campaignIds)
        .gte('occurred_at', daysAgoISO(days))
        .order('occurred_at', { ascending: true })
        .range(from, to)
    );

    const byDate: Record<string, { sent: number; opened: number; clicked: number; replied: number }> = {};

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      byDate[key] = { sent: 0, opened: 0, clicked: 0, replied: 0 };
    }

    for (const a of activities) {
      const dateKey = a.occurred_at?.slice(0, 10);
      if (!dateKey || !byDate[dateKey]) continue;
      switch (a.activity_type) {
        case 'sent': byDate[dateKey].sent++; break;
        case 'opened': byDate[dateKey].opened++; break;
        case 'clicked': byDate[dateKey].clicked++; break;
        case 'replied': byDate[dateKey].replied++; break;
      }
    }

    return Object.entries(byDate).map(([date, counts]) => ({ date, ...counts }));
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

    const activities = await fetchAllRows<{ activity_type: string }>((from, to) =>
      supabaseAdmin
        .from('campaign_activities')
        .select('activity_type')
        .eq('campaign_id', campaignId)
        .range(from, to)
    );

    const counts = { sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0, errors: 0 };
    for (const a of activities) {
      switch (a.activity_type) {
        case 'sent': counts.sent++; break;
        case 'opened': counts.opened++; break;
        case 'clicked': counts.clicked++; break;
        case 'replied': counts.replied++; break;
        case 'bounced': counts.bounced++; break;
        case 'error': counts.errors++; break;
      }
    }

    return {
      campaign_id: campaignId,
      total_contacts: totalContacts || 0,
      ...counts,
      open_rate: calcRate(counts.opened, counts.sent),
      click_rate: calcRate(counts.clicked, counts.sent),
      reply_rate: calcRate(counts.replied, counts.sent),
      bounce_rate: calcRate(counts.bounced, counts.sent),
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
        .range(from, to)
    );

    const allActivities = await fetchAllRows<{ contact_id: string; activity_type: string }>((from, to) =>
      supabaseAdmin
        .from('campaign_activities')
        .select('contact_id, activity_type')
        .eq('campaign_id', campaignId)
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
    lines.push(`Sent,${stats.sent}`);
    lines.push(`Opened,${stats.opened},${stats.open_rate}%`);
    lines.push(`Clicked,${stats.clicked},${stats.click_rate}%`);
    lines.push(`Replied,${stats.replied},${stats.reply_rate}%`);
    lines.push(`Bounced,${stats.bounced},${stats.bounce_rate}%`);
    lines.push(`Errors,${stats.errors}`);
    lines.push('');
    lines.push('Contact Breakdown');
    lines.push('Email,Name,Status,DCS,Sent,Opened,Clicked,Replied,Bounced');
    for (const c of contacts) {
      const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || '';
      const csvEmail = `"${c.email.replace(/"/g, '""')}"`;
      const csvName = `"${name.replace(/"/g, '""')}"`;
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
    lines.push(`Total Sent,${overview.total_sent}`);
    lines.push(`Total Opened,${overview.total_opened},${overview.avg_open_rate}%`);
    lines.push(`Total Clicked,${overview.total_clicked},${overview.avg_click_rate}%`);
    lines.push(`Total Replied,${overview.total_replied},${overview.avg_reply_rate}%`);
    lines.push('');
    lines.push('Campaigns');
    lines.push('Name,Status,Created');
    for (const c of campaigns || []) {
      lines.push(`"${c.name}",${c.status},${c.created_at}`);
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
      .select('id, activity_type, metadata, occurred_at, campaign_id, step_id, campaigns(name), campaign_steps(subject)')
      .eq('contact_id', contactId)
      .order('occurred_at', { ascending: false })
      .limit(100);

    if (error) throw new AppError(error.message, 500);

    return (data || []).map((a: any) => ({
      id: a.id,
      activity_type: a.activity_type,
      campaign_name: a.campaigns?.name || 'Unknown',
      step_subject: a.campaign_steps?.subject || null,
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

    const activities = await fetchAllRows<{ campaign_id: string; activity_type: string }>((from, to) =>
      supabaseAdmin
        .from('campaign_activities')
        .select('campaign_id, activity_type')
        .in('campaign_id', campaignIds)
        .range(from, to)
    );

    const stats = new Map<string, { sent: number; opened: number; clicked: number; replied: number; bounced: number }>();
    for (const id of campaignIds) {
      stats.set(id, { sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0 });
    }
    for (const a of activities) {
      const s = stats.get(a.campaign_id);
      if (!s) continue;
      switch (a.activity_type) {
        case 'sent': s.sent++; break;
        case 'opened': s.opened++; break;
        case 'clicked': s.clicked++; break;
        case 'replied': s.replied++; break;
        case 'bounced': s.bounced++; break;
      }
    }

    return campaigns.map((c: any) => {
      const s = stats.get(c.id) || { sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0 };
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        created_at: c.created_at,
        sent: s.sent,
        opened: s.opened,
        clicked: s.clicked,
        replied: s.replied,
        bounced: s.bounced,
        open_rate: calcRate(s.opened, s.sent),
        click_rate: calcRate(s.clicked, s.sent),
        reply_rate: calcRate(s.replied, s.sent),
        bounce_rate: calcRate(s.bounced, s.sent),
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

    const activities = await fetchAllRows<{ campaign_id: string; activity_type: string }>((from, to) =>
      supabaseAdmin
        .from('campaign_activities')
        .select('campaign_id, activity_type')
        .in('campaign_id', campaignIds)
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
        .range(from, to)
    );

    const revenue = new Map(revenueByCampaign(deals).map((r) => [r.campaignId, r]));

    const counts = new Map<string, { sent: number; replied: number }>();
    for (const id of campaignIds) counts.set(id, { sent: 0, replied: 0 });
    for (const a of activities) {
      const c = counts.get(a.campaign_id);
      if (!c) continue;
      if (a.activity_type === 'sent') c.sent++;
      else if (a.activity_type === 'replied') c.replied++;
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
        .range(from, to)
    );

    // Build variant lookup map from sent activities only (they're the only ones with ab_variant)
    const variantByContactStep = new Map<string, 'a' | 'b'>();
    for (const a of allActivities) {
      if (a.activity_type !== 'sent') continue;
      const variant = (a.metadata as any)?.ab_variant === 'b' ? 'b' : 'a';
      variantByContactStep.set(`${a.contact_id}:${a.step_id}`, variant);
    }

    const result = steps.map((step: any) => {
      const stats: Record<'a' | 'b', { sent: number; opened: number; clicked: number; replied: number }> = {
        a: { sent: 0, opened: 0, clicked: 0, replied: 0 },
        b: { sent: 0, opened: 0, clicked: 0, replied: 0 },
      };

      for (const a of allActivities) {
        if (a.step_id !== step.id) continue;
        const variant = variantByContactStep.get(`${a.contact_id}:${a.step_id}`);
        if (!variant) continue;

        switch (a.activity_type) {
          case 'sent': stats[variant].sent++; break;
          case 'opened': stats[variant].opened++; break;
          case 'clicked': stats[variant].clicked++; break;
          case 'replied': stats[variant].replied++; break;
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

    const activities = await fetchAllRows<{ activity_type: string; occurred_at: string }>((from, to) =>
      supabaseAdmin
        .from('campaign_activities')
        .select('activity_type, occurred_at')
        .eq('campaign_id', campaignId)
        .gte('occurred_at', daysAgoISO(days))
        .order('occurred_at', { ascending: true })
        .range(from, to)
    );

    const byDate: Record<string, { sent: number; opened: number; clicked: number; replied: number; bounced: number }> = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      byDate[d.toISOString().slice(0, 10)] = { sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0 };
    }

    for (const a of activities) {
      const dateKey = a.occurred_at?.slice(0, 10);
      if (!dateKey || !byDate[dateKey]) continue;
      switch (a.activity_type) {
        case 'sent': byDate[dateKey].sent++; break;
        case 'opened': byDate[dateKey].opened++; break;
        case 'clicked': byDate[dateKey].clicked++; break;
        case 'replied': byDate[dateKey].replied++; break;
        case 'bounced': byDate[dateKey].bounced++; break;
      }
    }

    return Object.entries(byDate).map(([date, counts]) => ({ date, ...counts }));
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

import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';

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

const MIN_AB_SAMPLE = 30;
const MIN_AB_GAP = 2; // percentage points

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

    const { data: activities } = await supabaseAdmin
      .from('campaign_activities')
      .select('activity_type, occurred_at')
      .in('campaign_id', campaignIds)
      .gte('occurred_at', daysAgoISO(days))
      .order('occurred_at', { ascending: true });

    const byDate: Record<string, { sent: number; opened: number; clicked: number; replied: number }> = {};

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      byDate[key] = { sent: 0, opened: 0, clicked: 0, replied: 0 };
    }

    for (const a of activities || []) {
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

    const { data: activities } = await supabaseAdmin
      .from('campaign_activities')
      .select('activity_type')
      .eq('campaign_id', campaignId);

    const counts = { sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0, errors: 0 };
    for (const a of activities || []) {
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

    const { data: campaignContacts } = await supabaseAdmin
      .from('campaign_contacts')
      .select('contact_id, status, contacts(email, first_name, last_name, dcs_score, is_bounced)')
      .eq('campaign_id', campaignId);

    const { data: allActivities } = await supabaseAdmin
      .from('campaign_activities')
      .select('contact_id, activity_type')
      .eq('campaign_id', campaignId);

    const activityByContact = new Map<string, { sent: number; opened: number; clicked: number; replied: boolean }>();
    for (const a of allActivities || []) {
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

    const contacts = (campaignContacts || []).map((cc: any) => {
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
    lines.push(`Campaign Report: ${campaignName}`);
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
      lines.push(`"${c.email}","${name}",${c.status},${c.dcs_score ?? ''},${c.sent},${c.opened},${c.clicked},${c.replied ? 'Yes' : 'No'},${c.is_bounced ? 'Yes' : 'No'}`);
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
      .single();

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

    const { data: activities } = await supabaseAdmin
      .from('campaign_activities')
      .select('campaign_id, activity_type')
      .in('campaign_id', campaignIds);

    const stats = new Map<string, { sent: number; opened: number; clicked: number; replied: number; bounced: number }>();
    for (const id of campaignIds) {
      stats.set(id, { sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0 });
    }
    for (const a of activities || []) {
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

    const { data: activities } = await supabaseAdmin
      .from('campaign_activities')
      .select('contact_id, activity_type, step_id')
      .eq('campaign_id', campaignId);

    if (!steps || steps.length === 0) {
      // No steps configured — aggregate across whole campaign
      const byType = new Map<string, Set<string>>();
      for (const a of activities || []) {
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

    for (const a of activities || []) {
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
      .select('id, step_number, subject, subject_b, body_html_b, delay_days')
      .eq('campaign_id', campaignId)
      .or('subject_b.not.is.null,body_html_b.not.is.null');

    if (!steps || steps.length === 0) return { has_ab_test: false, steps: [] };

    const stepIds = steps.map((s: any) => s.id);

    const { data: allActivities } = await supabaseAdmin
      .from('campaign_activities')
      .select('contact_id, step_id, activity_type, metadata')
      .eq('campaign_id', campaignId)
      .in('step_id', stepIds);

    // Build variant lookup map from sent activities only (they're the only ones with ab_variant)
    const variantByContactStep = new Map<string, 'a' | 'b'>();
    for (const a of allActivities || []) {
      if (a.activity_type !== 'sent') continue;
      const variant = (a.metadata as any)?.ab_variant === 'b' ? 'b' : 'a';
      variantByContactStep.set(`${a.contact_id}:${a.step_id}`, variant);
    }

    const result = steps.map((step: any) => {
      const stats: Record<'a' | 'b', { sent: number; opened: number; clicked: number; replied: number }> = {
        a: { sent: 0, opened: 0, clicked: 0, replied: 0 },
        b: { sent: 0, opened: 0, clicked: 0, replied: 0 },
      };

      for (const a of allActivities || []) {
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
      const openDiff = Math.abs(bOpenRate - aOpenRate);
      const significant = hasEnoughData && openDiff >= MIN_AB_GAP;
      const winner: 'a' | 'b' | null = significant ? (bOpenRate > aOpenRate ? 'b' : 'a') : null;

      return {
        step_number: step.step_number,
        step_id: step.id,
        subject_a: step.subject || `Step ${step.step_number}`,
        subject_b: step.subject_b || `Step ${step.step_number} – Variant B`,
        variant_a: { ...stats.a, open_rate: aOpenRate, click_rate: aClickRate, reply_rate: aReplyRate },
        variant_b: { ...stats.b, open_rate: bOpenRate, click_rate: bClickRate, reply_rate: bReplyRate },
        winner,
        significant,
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

    const { data: activities } = await supabaseAdmin
      .from('campaign_activities')
      .select('activity_type, occurred_at')
      .eq('campaign_id', campaignId)
      .gte('occurred_at', daysAgoISO(days))
      .order('occurred_at', { ascending: true });

    const byDate: Record<string, { sent: number; opened: number; clicked: number; replied: number; bounced: number }> = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      byDate[d.toISOString().slice(0, 10)] = { sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0 };
    }

    for (const a of activities || []) {
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

    const { data: activities } = await supabaseAdmin
      .from('campaign_activities')
      .select('activity_type, occurred_at')
      .eq('campaign_id', campaignId)
      .in('activity_type', ['opened', 'clicked', 'replied']);

    // 7 days × 24 hours engagement grid
    const grid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
    for (const a of activities || []) {
      if (!a.occurred_at) continue;
      const d = new Date(a.occurred_at);
      grid[d.getDay()][d.getHours()]++;
    }

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const maxValue = Math.max(1, ...grid.flat());
    return {
      grid: grid.map((row, i) => ({ day: days[i], hours: row })),
      max_value: maxValue,
    };
  },
};

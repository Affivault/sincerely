import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';

function calcRate(value: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((value / total) * 100 * 10) / 10;
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

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

    // Get activity counts across all user campaigns
    const { data: campaigns } = await supabaseAdmin
      .from('campaigns')
      .select('id')
      .eq('user_id', userId);

    const campaignIds = (campaigns || []).map((c: any) => c.id);

    let totalSent = 0, totalOpened = 0, totalClicked = 0, totalReplied = 0;

    if (campaignIds.length > 0) {
      const sinceFilter = days ? daysAgoISO(days) : null;

      const makeCountQuery = (type: string) => {
        let q = supabaseAdmin
          .from('campaign_activities')
          .select('*', { count: 'exact', head: true })
          .in('campaign_id', campaignIds)
          .eq('activity_type', type);
        if (sinceFilter) q = q.gte('occurred_at', sinceFilter);
        return q;
      };

      const [sentRes, openedRes, clickedRes, repliedRes] = await Promise.all([
        makeCountQuery('sent'),
        makeCountQuery('opened'),
        makeCountQuery('clicked'),
        makeCountQuery('replied'),
      ]);

      totalSent = sentRes.count || 0;
      totalOpened = openedRes.count || 0;
      totalClicked = clickedRes.count || 0;
      totalReplied = repliedRes.count || 0;
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

    // Group by date
    const byDate: Record<string, { sent: number; opened: number; clicked: number; replied: number }> = {};

    // Pre-fill all dates in range
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

    return Object.entries(byDate).map(([date, counts]) => ({
      date,
      ...counts,
    }));
  },

  async campaign(userId: string, campaignId: string) {
    // Verify ownership
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
      .select('contact_id, status, contacts(email, first_name, last_name)')
      .eq('campaign_id', campaignId);

    // Fetch all activities for this campaign in one query, then group by contact_id
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

    // Build CSV
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
    lines.push('Email,Name,Status,Sent,Opened,Clicked,Replied');
    for (const c of contacts) {
      const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || '';
      lines.push(`"${c.email}","${name}",${c.status},${c.sent},${c.opened},${c.clicked},${c.replied ? 'Yes' : 'No'}`);
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
    // Verify contact ownership
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
};

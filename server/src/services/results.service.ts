/* ═══════════════════════════════════════════════════════════════════════
   Results: what the outreach produced in a period.

   See shared/results for the rules. This gathers the numbers for a
   period and the one before it:

     sent / replies    campaign activity in the period
     positive          replies to campaign mail read as interested or
                       asking to meet
     meetings          meetings with a source campaign, booked in the
                       period and not cancelled
     deals, pipeline   deals with a source campaign, opened in the period
     won               deals with a source campaign, won in the period

   And the same per campaign, so the report can say which ones did it.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import {
  resultsPeriod, previousPeriod, resultsHeadline, emptyNumbers, addMoney, sortMoney, dealValue,
  REPLY_CHECK_CAMPAIGN_NAME,
  type ResultsPeriodKey, type ResultsPeriod, type ResultsNumbers, type ResultsReport, type CampaignResult,
} from '@lemlist/shared';

/** Campaigns broken down individually; the rest still count in the totals. */
const MAX_CAMPAIGNS = 60;

async function countActivity(userId: string, type: string, from: string, to: string, campaignId?: string): Promise<number> {
  let q = supabaseAdmin
    .from('campaign_activities')
    .select('id, campaigns!inner(user_id)', { count: 'exact', head: true })
    .eq('campaigns.user_id', userId)
    .eq('activity_type', type)
    .gte('occurred_at', from)
    .lt('occurred_at', to);
  if (campaignId) q = q.eq('campaign_id', campaignId);
  const { count, error } = await q;
  if (error) throw new Error(`results ${type}: ${error.message}`);
  return count || 0;
}

interface DealRow {
  stage: string; currency: string | null; value: number | null;
  recurring_amount: number | null; recurring_period: string | null; one_off_amount: number | null; term_months: number | null;
  source_campaign_id: string | null; created_at: string; closed_at: string | null; stage_changed_at: string | null;
}

async function gather(userId: string, period: Pick<ResultsPeriod, 'from' | 'to'>) {
  const { from, to } = period;
  const [sent, replies, positive, meetingsRes, createdRes, wonRes] = await Promise.all([
    countActivity(userId, 'sent', from, to),
    countActivity(userId, 'replied', from, to),
    supabaseAdmin.from('inbox_messages').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('direction', 'inbound').not('campaign_id', 'is', null)
      .in('sara_intent', ['interested', 'meeting'])
      .gte('received_at', from).lt('received_at', to)
      .then((r) => r.count || 0),
    supabaseAdmin.from('crm_events').select('id, source_campaign_id')
      .eq('user_id', userId).eq('type', 'meeting').not('source_campaign_id', 'is', null).is('cancelled_at', null)
      .gte('created_at', from).lt('created_at', to)
      .limit(5000),
    supabaseAdmin.from('deals').select('stage, currency, value, recurring_amount, recurring_period, one_off_amount, term_months, source_campaign_id, created_at, closed_at, stage_changed_at')
      .eq('user_id', userId).not('source_campaign_id', 'is', null)
      .gte('created_at', from).lt('created_at', to)
      .limit(5000),
    supabaseAdmin.from('deals').select('stage, currency, value, recurring_amount, recurring_period, one_off_amount, term_months, source_campaign_id, created_at, closed_at, stage_changed_at')
      .eq('user_id', userId).not('source_campaign_id', 'is', null).eq('stage', 'won')
      .or(`and(closed_at.gte.${from},closed_at.lt.${to}),and(closed_at.is.null,stage_changed_at.gte.${from},stage_changed_at.lt.${to})`)
      .limit(5000),
  ]);
  if (meetingsRes.error) throw new Error(`results meetings: ${meetingsRes.error.message}`);
  if (createdRes.error) throw new Error(`results deals: ${createdRes.error.message}`);
  if (wonRes.error) throw new Error(`results won: ${wonRes.error.message}`);

  const numbers: ResultsNumbers = { ...emptyNumbers(), sent, replies, positive };
  numbers.meetings = (meetingsRes.data || []).length;
  for (const d of (createdRes.data || []) as DealRow[]) {
    numbers.deals++;
    addMoney(numbers.pipeline, d.currency, dealValue(d as any));
  }
  for (const d of (wonRes.data || []) as DealRow[]) {
    numbers.won_deals++;
    addMoney(numbers.won, d.currency, dealValue(d as any));
  }
  numbers.pipeline = sortMoney(numbers.pipeline);
  numbers.won = sortMoney(numbers.won);
  return { numbers, meetings: meetingsRes.data || [], created: (createdRes.data || []) as DealRow[], won: (wonRes.data || []) as DealRow[] };
}

async function byCampaign(userId: string, period: Pick<ResultsPeriod, 'from' | 'to'>, g: Awaited<ReturnType<typeof gather>>): Promise<CampaignResult[]> {
  // Campaigns that could have done something in the period: started before
  // it ended, and not finished before it began.
  const { data: camps } = await supabaseAdmin
    .from('campaigns')
    .select('id, name, status, started_at, completed_at, created_at')
    .eq('user_id', userId)
    .neq('name', REPLY_CHECK_CAMPAIGN_NAME)
    .neq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(300);
  const live = (camps || []).filter((c: any) => {
    const started = Date.parse(c.started_at || c.created_at);
    const done = c.completed_at ? Date.parse(c.completed_at) : Infinity;
    return started < Date.parse(period.to) && done >= Date.parse(period.from) - 30 * 86_400_000;
  }).slice(0, MAX_CAMPAIGNS);

  const rows = await Promise.all(live.map(async (c: any): Promise<CampaignResult> => {
    const [sent, replies] = await Promise.all([
      countActivity(userId, 'sent', period.from, period.to, c.id),
      countActivity(userId, 'replied', period.from, period.to, c.id),
    ]);
    const r: CampaignResult = { id: c.id, name: c.name, sent, replies, meetings: 0, deals: 0, pipeline: [], won: [] };
    r.meetings = g.meetings.filter((m: any) => m.source_campaign_id === c.id).length;
    for (const d of g.created) if (d.source_campaign_id === c.id) { r.deals++; addMoney(r.pipeline, d.currency, dealValue(d as any)); }
    for (const d of g.won) if (d.source_campaign_id === c.id) addMoney(r.won, d.currency, dealValue(d as any));
    return r;
  }));
  const score = (r: CampaignResult) => (r.won[0]?.amount || 0) * 1e6 + (r.pipeline[0]?.amount || 0) * 1e3 + r.meetings * 100 + r.replies;
  return rows.filter((r) => r.sent || r.replies || r.meetings || r.deals).sort((a, b) => score(b) - score(a));
}

async function zoneOf(userId: string): Promise<string> {
  const { data } = await supabaseAdmin.from('user_settings').select('timezone').eq('user_id', userId).maybeSingle();
  return (data as any)?.timezone || 'UTC';
}

export const resultsService = {
  async report(userId: string, period: ResultsPeriodKey | { from: string; end: string; label: string }, opts: { campaigns?: boolean; now?: number } = {}): Promise<ResultsReport> {
    const now = opts.now ?? Date.now();
    const tz = await zoneOf(userId);
    const p: ResultsPeriod = typeof period === 'string'
      ? resultsPeriod(period, now, tz)
      : {
        key: 'custom', label: period.label, from: period.from, end: period.end,
        to: new Date(Math.min(Date.parse(period.end), now)).toISOString(), partial: Date.parse(period.end) > now,
      };
    const prev = previousPeriod(p, tz);
    const [cur, before] = await Promise.all([gather(userId, p), gather(userId, prev)]);
    const campaigns = opts.campaigns === false ? [] : await byCampaign(userId, p, cur);
    const currency = cur.numbers.won[0]?.currency || cur.numbers.pipeline[0]?.currency || 'USD';
    return {
      period: p,
      previous: prev,
      current: cur.numbers,
      before: before.numbers,
      headline: resultsHeadline(p, cur.numbers, currency),
      campaigns,
      generated_at: new Date(now).toISOString(),
    };
  },
};

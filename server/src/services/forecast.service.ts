/* ═══════════════════════════════════════════════════════════════════════
   Gathers what the launch forecast simulates (see shared/forecast.ts):
   the sequence, who is waiting for which step, the mailboxes that will
   carry it with their warm-up ramps, the schedule, and the account's own
   reply history.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import {
  forecastCampaign, warmupAllowance, isLinkedinStep,
  type CampaignForecast, type ForecastMailbox,
} from '@lemlist/shared';
import { fetchAllPages } from '../utils/batch.js';

const DAY = 86_400_000;

export async function campaignForecast(userId: string, campaignId: string): Promise<CampaignForecast> {
  const { data: campaign, error } = await supabaseAdmin
    .from('campaigns')
    .select('id, user_id, status, daily_limit, send_days, smtp_account_id, scheduled_at')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw new AppError(error.message, 500);
  if (!campaign || campaign.user_id !== userId) throw new AppError('Campaign not found', 404);

  const { data: steps, error: sErr } = await supabaseAdmin
    .from('campaign_steps')
    .select('step_order, step_type, delay_days, delay_hours, delay_minutes')
    .eq('campaign_id', campaignId)
    .order('step_order', { ascending: true });
  if (sErr) throw new AppError(sErr.message, 500);
  const ordered = steps || [];
  const indexOfOrder = new Map<number, number>(ordered.map((s: any, i: number) => [s.step_order, i]));

  // Everyone still to be sent something.
  const rows = await fetchAllPages<{ status: string; current_step_order: number | null; next_send_at: string | null }>(
    async (from, to) => await supabaseAdmin
      .from('campaign_contacts')
      .select('status, current_step_order, next_send_at')
      .eq('campaign_id', campaignId)
      .in('status', ['pending', 'active'])
      .range(from, to),
  );
  const now = Date.now();
  const startAt = campaign.status === 'scheduled' && campaign.scheduled_at ? new Date(campaign.scheduled_at).getTime() : now;
  const buckets = new Map<string, { step: number; due_in_days: number; count: number }>();
  for (const r of rows) {
    // current_step_order is the step they are waiting for (the send engine
    // moves it forward as each one goes). Pending contacts wait for the start.
    const step = indexOfOrder.get(r.current_step_order ?? -1) ?? 0;
    let dueIn = Math.max(0, (startAt - now) / DAY);
    if (r.status === 'active' && r.next_send_at) {
      dueIn = Math.max(0, (new Date(r.next_send_at).getTime() - now) / DAY);
    }
    if (step >= ordered.length) continue;
    const key = `${step}:${Math.ceil(dueIn)}`;
    const b = buckets.get(key) ?? { step, due_in_days: Math.ceil(dueIn), count: 0 };
    b.count++;
    buckets.set(key, b);
  }

  // The mailboxes it will actually use: the campaign's pool, else every sender.
  const { data: pool } = await supabaseAdmin
    .from('campaign_smtp_accounts').select('smtp_account_id').eq('campaign_id', campaignId);
  let q = supabaseAdmin.from('smtp_accounts')
    .select('id, email_address, label, daily_send_limit, warmup_mode, warmup_daily_target, warmup_started_at, warmup_start_volume, warmup_ramp_days')
    .eq('user_id', userId).eq('is_active', true).eq('is_verified', true).eq('is_seed', false);
  const ids = (pool || []).map((p: any) => p.smtp_account_id);
  if (ids.length > 0) q = q.in('id', ids);
  else if (campaign.smtp_account_id) q = q.eq('id', campaign.smtp_account_id);
  const { data: accounts, error: aErr } = await q;
  if (aErr) throw new AppError(aErr.message, 500);

  // Other running campaigns draw on the same mailboxes; share them out evenly.
  const { count: othersRunning } = await supabaseAdmin
    .from('campaigns').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('status', 'running').neq('id', campaignId);
  const share = 1 / (1 + (othersRunning || 0));

  const mailboxes: ForecastMailbox[] = (accounts || []).map((a: any) => ({
    label: a.label || a.email_address,
    capacity: (offset: number) => {
      // The warm-up ramp as it will stand `offset` days from now.
      const shifted = a.warmup_started_at
        ? new Date(new Date(a.warmup_started_at).getTime() - offset * DAY).toISOString()
        : a.warmup_started_at;
      const full = warmupAllowance({ ...a, warmup_started_at: shifted });
      return full === 0 ? 0 : Math.max(1, Math.floor(full * share));
    },
  }));

  // The account's own history, for the projection: sends, replies, and the
  // replies that were interested or asked to meet.
  const since = new Date(now - 180 * DAY).toISOString();
  const count = async (type: string) => {
    const { count: c } = await supabaseAdmin.from('campaign_activities')
      .select('id, campaigns!inner(user_id)', { count: 'exact', head: true })
      .eq('campaigns.user_id', userId).eq('activity_type', type).gte('occurred_at', since);
    return c || 0;
  };
  const [sent, replies, positiveRes] = await Promise.all([
    count('sent'),
    count('replied'),
    supabaseAdmin.from('inbox_messages').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).in('sara_intent', ['interested', 'meeting']).gte('received_at', since),
  ]);

  const forecast = forecastCampaign({
    steps: ordered.map((s: any) => ({
      is_email: s.step_type === 'email',
      delay_days: (s.delay_days || 0) + (s.delay_hours || 0) / 24 + (s.delay_minutes || 0) / 1440,
    })),
    positions: [...buckets.values()],
    send_days: campaign.send_days || [],
    daily_limit: campaign.daily_limit || 0,
    per_mailbox_window_cap: 0,
    mailboxes,
    start: new Date(),
    history: { sent, replies, positive: positiveRes.count || 0 },
  });
  if ((othersRunning || 0) > 0 && mailboxes.length > 0) {
    forecast.warnings.push(`${othersRunning} other running campaign${othersRunning === 1 ? '' : 's'} share these mailboxes; this assumes an even split.`);
  }
  if (ordered.some((s: any) => isLinkedinStep(s.step_type))) {
    forecast.warnings.push('LinkedIn steps become tasks and depend on you doing them; they are not counted as sends.');
  }
  return forecast;
}

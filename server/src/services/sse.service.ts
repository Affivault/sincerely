import { supabaseAdmin } from '../config/supabase.js';
import type { SmtpAccount, SmtpAccountHealthSummary, SseSelectionResult } from '@lemlist/shared';

/**
 * SSE - Smart-Sharding Engine
 * Intelligently distributes email volume across sender accounts
 * to maximize inbox placement and protect sender reputation.
 */

const HEALTH_WEIGHT = 0.6;
const UTILIZATION_WEIGHT = 0.4;

/**
 * Select the best SMTP account for sending the next email in a campaign.
 * Uses a scoring algorithm based on health score and current utilization.
 */
export async function selectBestSender(
  userId: string,
  campaignId: string
): Promise<SseSelectionResult> {
  // First try campaign-specific SMTP pool
  const { data: poolAccounts } = await supabaseAdmin
    .from('campaign_smtp_accounts')
    .select('smtp_account_id, priority')
    .eq('campaign_id', campaignId);

  let accountIds: string[] | null = null;
  if (poolAccounts && poolAccounts.length > 0) {
    accountIds = poolAccounts.map((p: any) => p.smtp_account_id);
  }

  // Query available accounts
  let query = supabaseAdmin
    .from('smtp_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('is_verified', true);

  if (accountIds) {
    query = query.in('id', accountIds);
  }

  const { data: accounts, error } = await query;

  if (error || !accounts || accounts.length === 0) {
    return {
      account: null,
      reason: 'No active, verified SMTP accounts found',
      all_exhausted: true,
    };
  }

  // Filter accounts that still have capacity (limit=0 means unlimited)
  const available = accounts.filter((a: SmtpAccount) => {
    const limit = a.warmup_mode ? a.warmup_daily_target : a.daily_send_limit;
    return limit === 0 || a.sends_today < limit;
  });

  if (available.length === 0) {
    return {
      account: null,
      reason: 'All accounts have reached their daily sending limit',
      all_exhausted: true,
    };
  }

  // Score each account: higher is better
  const scored = available.map((a: SmtpAccount) => {
    const limit = a.warmup_mode ? a.warmup_daily_target : a.daily_send_limit;
    const healthComponent = a.health_score * HEALTH_WEIGHT;
    // limit=0 means unlimited — treat as fully available (100% capacity remaining)
    const utilizationComponent = (limit === 0 ? 100 : (1 - a.sends_today / limit) * 100) * UTILIZATION_WEIGHT;
    const score = healthComponent + utilizationComponent;
    return { account: a, score };
  });

  // Sort by score descending and pick the best
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  return {
    account: best.account,
    reason: `Selected ${best.account.label} (score: ${best.score.toFixed(1)}, health: ${best.account.health_score}, utilization: ${best.account.sends_today}/${best.account.warmup_mode ? best.account.warmup_daily_target : best.account.daily_send_limit})`,
    all_exhausted: false,
  };
}

/**
 * Record a successful send - increment counters and update health.
 */
export async function recordSend(accountId: string): Promise<void> {
  try {
    await supabaseAdmin.rpc('increment_field', {
      table_name: 'smtp_accounts',
      field_name: 'sends_today',
      row_id: accountId,
    });
  } catch {
    // Fallback: direct update if RPC doesn't exist
    try {
      const { data } = await supabaseAdmin
        .from('smtp_accounts')
        .select('sends_today, total_sent')
        .eq('id', accountId)
        .single();
      if (data) {
        await supabaseAdmin
          .from('smtp_accounts')
          .update({
            sends_today: data.sends_today + 1,
            total_sent: data.total_sent + 1,
          })
          .eq('id', accountId);
      }
    } catch (fallbackErr: any) {
      console.error(`[SSE] Failed to record send for account ${accountId}:`, fallbackErr.message);
    }
  }
}

/**
 * Record a bounce - decrement health score.
 */
export async function recordBounce(accountId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from('smtp_accounts')
    .select('health_score, total_bounced')
    .eq('id', accountId)
    .single();

  if (data) {
    const newHealth = Math.max(0, data.health_score - 5);
    await supabaseAdmin
      .from('smtp_accounts')
      .update({
        health_score: newHealth,
        total_bounced: data.total_bounced + 1,
        last_bounce_at: new Date().toISOString(),
      })
      .eq('id', accountId);
  }
}

/**
 * Record an open - slightly recover health score.
 */
export async function recordOpen(accountId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from('smtp_accounts')
    .select('health_score, total_opened')
    .eq('id', accountId)
    .single();

  if (data) {
    const newHealth = Math.min(100, data.health_score + 1);
    await supabaseAdmin
      .from('smtp_accounts')
      .update({
        health_score: newHealth,
        total_opened: data.total_opened + 1,
      })
      .eq('id', accountId);
  }
}

/**
 * Get health summary for all accounts (for dashboard).
 */
export async function getHealthDashboard(
  userId: string
): Promise<SmtpAccountHealthSummary[]> {
  const { data: accounts } = await supabaseAdmin
    .from('smtp_accounts')
    .select('*')
    .eq('user_id', userId)
    .order('health_score', { ascending: false });

  if (!accounts) return [];

  return accounts.map((a: SmtpAccount) => {
    const limit = a.warmup_mode ? a.warmup_daily_target : a.daily_send_limit;
    return {
      id: a.id,
      label: a.label,
      email_address: a.email_address,
      health_score: a.health_score,
      sends_today: a.sends_today,
      daily_send_limit: a.daily_send_limit,
      utilization_pct: limit > 0 ? Math.round((a.sends_today / limit) * 100) : 0,
      bounce_rate_7d: a.bounce_rate_7d,
      warmup_mode: a.warmup_mode,
      is_available: a.is_active && a.is_verified && (limit === 0 || a.sends_today < limit),
    };
  });
}

/**
 * Manage campaign SMTP pool - assign accounts to a campaign.
 */
export async function setCampaignPool(
  campaignId: string,
  accountIds: string[]
): Promise<void> {
  // Remove existing
  await supabaseAdmin
    .from('campaign_smtp_accounts')
    .delete()
    .eq('campaign_id', campaignId);

  // Insert new
  if (accountIds.length > 0) {
    const rows = accountIds.map((id, idx) => ({
      campaign_id: campaignId,
      smtp_account_id: id,
      priority: idx,
    }));
    await supabaseAdmin
      .from('campaign_smtp_accounts')
      .insert(rows);
  }
}

/**
 * Get campaign SMTP pool.
 */
export async function getCampaignPool(campaignId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('campaign_smtp_accounts')
    .select('smtp_account_id')
    .eq('campaign_id', campaignId)
    .order('priority');

  return data?.map((r: any) => r.smtp_account_id) || [];
}

/**
 * Reset daily send counts (should be called by a daily cron job).
 */
export async function resetDailySendCounts(): Promise<number> {
  const { data } = await supabaseAdmin
    .from('smtp_accounts')
    .update({
      sends_today: 0,
      last_send_reset_at: new Date().toISOString(),
    })
    .gt('sends_today', 0)
    .select('id');

  return data?.length || 0;
}

/**
 * Recalculate 7-day bounce rates for all accounts.
 */
export async function recalculateBounceRates(): Promise<void> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: accounts } = await supabaseAdmin
    .from('smtp_accounts')
    .select('id, total_sent, total_bounced');

  if (!accounts) return;

  for (const account of accounts) {
    // Simple calculation: total_bounced / total_sent * 100
    const bounceRate = account.total_sent > 0
      ? (account.total_bounced / account.total_sent) * 100
      : 0;

    await supabaseAdmin
      .from('smtp_accounts')
      .update({ bounce_rate_7d: Math.round(bounceRate * 10) / 10 })
      .eq('id', account.id);
  }
}

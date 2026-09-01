import { supabaseAdmin } from '../config/supabase.js';
import type { SmtpAccount, SmtpAccountHealthSummary, SseSelectionResult } from '@lemlist/shared';
import { warmupAllowance } from '@lemlist/shared';

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
 *
 * Pass `reserve: true` when the caller is about to actually send — this
 * atomically claims the winning account's warm-up/ramp slot before
 * returning it, so a concurrent processDueSteps() run can't also pick it.
 * Leave it false (the default) for read-only previews like the dashboard's
 * "which account would be used next" endpoint — reserving there would burn
 * real ramp capacity every time someone just looks at the page.
 */
export async function selectBestSender(
  userId: string,
  campaignId: string,
  reserve = false
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

  // Filter accounts that still have capacity (limit=0 means unlimited).
  // While a mailbox is warming up, its cap is the ramped allowance, not the
  // full daily limit — this is what protects a new inbox's reputation.
  const available = accounts.filter((a: SmtpAccount) => {
    const limit = warmupAllowance(a);
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
    const limit = warmupAllowance(a);
    const healthComponent = a.health_score * HEALTH_WEIGHT;
    // limit=0 means unlimited — treat as fully available (100% capacity remaining)
    const utilizationComponent = (limit === 0 ? 100 : (1 - a.sends_today / limit) * 100) * UTILIZATION_WEIGHT;
    const score = healthComponent + utilizationComponent;
    return { account: a, score };
  });

  // Sort by score descending and pick the best.
  scored.sort((a, b) => b.score - a.score);

  if (!reserve) {
    const best = scored[0];
    return {
      account: best.account,
      reason: `Selected ${best.account.label} (score: ${best.score.toFixed(1)}, health: ${best.account.health_score}, utilization: ${best.account.sends_today}/${warmupAllowance(best.account)})`,
      all_exhausted: false,
    };
  }

  // Caller is about to send: try to atomically reserve a slot on each
  // candidate, best first. The filter above is just a snapshot — a
  // concurrent processDueSteps() run (worker tick racing a launch()-
  // triggered call) can exhaust the same account's ramp allowance between
  // the read and the reserve, so fall through to the next-best candidate on
  // a lost race instead of over-sending on the account the snapshot said was fine.
  for (const candidate of scored) {
    const limit = warmupAllowance(candidate.account);
    if (!(await reserveWarmupSend(candidate.account.id, limit))) continue;
    return {
      account: candidate.account,
      reason: `Selected ${candidate.account.label} (score: ${candidate.score.toFixed(1)}, health: ${candidate.account.health_score}, utilization: ${candidate.account.sends_today}/${limit})`,
      all_exhausted: false,
    };
  }

  return {
    account: null,
    reason: 'All accounts have reached their daily sending limit',
    all_exhausted: true,
  };
}

/**
 * Atomically reserve one warm-up/daily send slot on an SMTP account. Returns
 * true and increments sends_today if within the allowance (limit<=0 means
 * unlimited), false if it would exceed it or the account no longer exists.
 * Use this at selection time, before the SMTP send, and refund with
 * refundWarmupSend() if the send doesn't actually happen.
 */
export async function reserveWarmupSend(accountId: string, limit: number): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc('reserve_warmup_send', {
    p_account_id: accountId,
    p_limit: limit,
  });
  if (!error) return data === true;
  // Fail closed if the atomic RPC is missing (e.g. migration 036 not
  // applied) rather than falling back to a check+increment that concurrent
  // sends could race past the ramp cap.
  console.error(`[SSE] reserve_warmup_send RPC unavailable, denying send: ${error.message}`);
  return false;
}

/** Return a warm-up slot reserved via reserveWarmupSend() that wasn't used (the send failed). */
export async function refundWarmupSend(accountId: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc('refund_warmup_send', { p_account_id: accountId });
  if (error) {
    console.error(`[SSE] Failed to refund warm-up send for ${accountId}:`, error.message);
  }
}

/**
 * Record a successful send - increment counters and update health.
 *
 * @param alreadyReserved Pass true when the caller already atomically
 *   reserved this send's sends_today slot via reserveWarmupSend() (the
 *   internal campaign-send pipeline does, at selection time) — incrementing
 *   it again here would double-count that send against the ramp cap. The
 *   public "record an external send" API route does NOT reserve first, so
 *   it leaves this false and gets the original increment-both behavior.
 */
export async function recordSend(accountId: string, alreadyReserved = false): Promise<void> {
  try {
    await supabaseAdmin.rpc('increment_field', {
      table_name: 'smtp_accounts',
      field_name: 'total_sent',
      row_id: accountId,
    });
    if (!alreadyReserved) {
      await supabaseAdmin.rpc('increment_field', {
        table_name: 'smtp_accounts',
        field_name: 'sends_today',
        row_id: accountId,
      });
    }
  } catch {
    // Fallback: direct update if RPC doesn't exist
    try {
      const { data } = await supabaseAdmin
        .from('smtp_accounts')
        .select('sends_today, total_sent')
        .eq('id', accountId)
        .maybeSingle();
      if (data) {
        await supabaseAdmin
          .from('smtp_accounts')
          .update({
            total_sent: data.total_sent + 1,
            ...(!alreadyReserved ? { sends_today: data.sends_today + 1 } : {}),
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
  // Atomically increment the bounce counter (mirrors recordSend's RPC approach)
  let rpcSucceeded = false;
  try {
    await supabaseAdmin.rpc('increment_field', {
      table_name: 'smtp_accounts',
      field_name: 'total_bounced',
      row_id: accountId,
    });
    rpcSucceeded = true;
  } catch {
    // RPC not available — fall back to manual update below
  }

  // Atomic clamped decrement (GREATEST(0, score-5)) via adjust_health_score:
  // a single UPDATE per account, so concurrent bounces on the same mailbox
  // can't race a read-then-write and lose an adjustment.
  const { error: healthErr } = await supabaseAdmin.rpc('adjust_health_score', {
    p_account_id: accountId,
    p_delta: -5,
  });
  if (healthErr) {
    console.error(`[SSE] recordBounce health-score RPC failed for ${accountId}, falling back:`, healthErr.message);
  }

  // last_bounce_at always needs a plain write; health_score/total_bounced are
  // only included here when the atomic RPCs above couldn't apply them.
  const { data, error } = await supabaseAdmin
    .from('smtp_accounts')
    .select('health_score, total_bounced')
    .eq('id', accountId)
    .single();

  if (error) {
    console.error(`[SSE] recordBounce fetch failed for ${accountId}:`, error.message);
    return;
  }

  if (data) {
    await supabaseAdmin
      .from('smtp_accounts')
      .update({
        last_bounce_at: new Date().toISOString(),
        ...(healthErr ? { health_score: Math.max(0, data.health_score - 5) } : {}),
        // Only include total_bounced in fallback — RPC already incremented it atomically
        ...(!rpcSucceeded ? { total_bounced: data.total_bounced + 1 } : {}),
      })
      .eq('id', accountId);
  }
}

/**
 * Record an open - slightly recover health score.
 */
export async function recordOpen(accountId: string): Promise<void> {
  // Atomically increment total_opened (mirrors recordSend's RPC approach to avoid
  // lost-update races when multiple opens arrive concurrently for the same account).
  let rpcSucceeded = false;
  try {
    await supabaseAdmin.rpc('increment_field', {
      table_name: 'smtp_accounts',
      field_name: 'total_opened',
      row_id: accountId,
    });
    rpcSucceeded = true;
  } catch {
    // RPC not available — fall back to manual update below
  }

  // Atomic clamped increment (LEAST(100, score+1)) via adjust_health_score: a
  // single UPDATE per account, so concurrent opens on the same mailbox can't
  // race a read-then-write and lose an adjustment.
  const { error: healthErr } = await supabaseAdmin.rpc('adjust_health_score', {
    p_account_id: accountId,
    p_delta: 1,
  });
  if (healthErr) {
    console.error(`[SSE] recordOpen health-score RPC failed for ${accountId}, falling back:`, healthErr.message);
  }

  if (rpcSucceeded && !healthErr) return; // both atomic RPCs applied — nothing left to do

  // Fallback path for whichever piece the atomic RPCs above couldn't handle.
  const { data, error } = await supabaseAdmin
    .from('smtp_accounts')
    .select('health_score, total_opened')
    .eq('id', accountId)
    .single();

  if (error) {
    console.error(`[SSE] recordOpen fetch failed for ${accountId}:`, error.message);
    return;
  }

  if (data) {
    await supabaseAdmin
      .from('smtp_accounts')
      .update({
        ...(healthErr ? { health_score: Math.min(100, data.health_score + 1) } : {}),
        // Only include total_opened in fallback — RPC already incremented it atomically
        ...(!rpcSucceeded ? { total_opened: data.total_opened + 1 } : {}),
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
    const limit = warmupAllowance(a);
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
  const { data, error } = await supabaseAdmin
    .from('smtp_accounts')
    .update({
      sends_today: 0,
      last_send_reset_at: new Date().toISOString(),
    })
    .gt('sends_today', 0)
    .select('id');
  if (error) throw new Error(`Failed to reset sends_today: ${error.message}`);

  // Reset the separate warm-up traffic counter too.
  const { error: warmupError } = await supabaseAdmin
    .from('smtp_accounts')
    .update({ warmup_sent_today: 0 })
    .gt('warmup_sent_today', 0);
  if (warmupError) throw new Error(`Failed to reset warmup_sent_today: ${warmupError.message}`);

  return data?.length || 0;
}

/**
 * Recalculate bounce rates for all accounts using total lifetime sent/bounced counters.
 * The result is stored in bounce_rate_7d as a rolling approximation; for a true 7-day
 * rate, query campaign_activities directly filtered by occurred_at.
 */
export async function recalculateBounceRates(): Promise<void> {
  const { data: accounts } = await supabaseAdmin
    .from('smtp_accounts')
    .select('id, total_sent, total_bounced');

  if (!accounts) return;

  for (const account of accounts) {
    const bounceRate = account.total_sent > 0
      ? (account.total_bounced / account.total_sent) * 100
      : 0;

    await supabaseAdmin
      .from('smtp_accounts')
      .update({ bounce_rate_7d: Math.round(bounceRate * 10) / 10 })
      .eq('id', account.id);
  }
}

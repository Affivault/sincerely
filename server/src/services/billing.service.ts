import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { accountControls } from './account-controls.service.js';
import { platformSettings } from './platform-settings.service.js';
import {
  PLANS,
  type PlanId,
  type PlanLimits,
  type PlanFeatures,
  type SubscriptionStatus,
  type UsageSummary, plural, TRIAL_CREDIT_CAP } from '@lemlist/shared';

// New users (and anyone without an active/trialing subscription) sit on the
// restrictive Free plan until they subscribe.
const DEFAULT_PLAN: PlanId = 'free';

/** ISO date (YYYY-MM-DD, UTC) of the first day of the current month. */
function currentPeriodStart(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

async function getSubscription(userId: string): Promise<any | null> {
  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  // A real lookup failure (network/DB error) must not be treated the same as
  // "no subscription row" — that silently drops a paying customer to Free
  // plan limits for the duration of the outage.
  if (error) throw new AppError(`Failed to look up subscription: ${error.message}`, 500);
  return data ?? null;
}

function planFromSubscription(sub: any | null): PlanId {
  if (!sub) return DEFAULT_PLAN;
  // Manually granted lifetime access overrides everything, regardless of
  // Stripe status — it is never sold, so Stripe state is irrelevant to it.
  if (sub.plan === 'lifetime') return 'lifetime';
  const status = sub.status as SubscriptionStatus;
  if (status === 'active' || status === 'trialing') {
    return PLANS[sub.plan as PlanId] ? (sub.plan as PlanId) : DEFAULT_PLAN;
  }
  // past_due / canceled / incomplete → drop back to Free until they pay.
  return 'free';
}

/*
 * A Stripe trial is free until its first payment, so it gets at most
 * TRIAL_CREDIT_CAP credits whatever plan it is trialling. A hand-set
 * subscriptions.credit_allowance (a Scale deal) wins over the plan's.
 */
function creditAllowanceFor(sub: any | null): number {
  const planId = planFromSubscription(sub);
  const custom = sub?.credit_allowance;
  if (custom !== null && custom !== undefined && Number.isFinite(Number(custom))) return Number(custom);
  const base = PLANS[planId].prospectCredits;
  if (trialCapped(sub)) return base < 0 ? TRIAL_CREDIT_CAP : Math.min(base, TRIAL_CREDIT_CAP);
  return base;
}

/** A suspended account sends nothing, connects nothing and spends nothing. */
const SUSPENDED_LIMITS: PlanLimits = { ...PLANS.free, maxInboxes: 0, emailsPerMonth: 0, prospectCredits: 0 };

function trialCapped(sub: any | null): boolean {
  return !!sub && sub.plan !== 'lifetime' && sub.status === 'trialing';
}

export const billingService = {
  async getPlanId(userId: string): Promise<PlanId> {
    return planFromSubscription(await getSubscription(userId));
  },

  /** Credits a month for this account (-1 = unlimited, which no plan is any more). */
  async getCreditAllowance(userId: string): Promise<number> {
    const [sub, suspended] = await Promise.all([getSubscription(userId), accountControls.isSuspended(userId), platformSettings.get()]);
    return suspended ? 0 : creditAllowanceFor(sub);
  },

  /** The allowance a subscription row carries, for the admin backend's account list. */
  creditAllowanceFor(sub: any | null): number {
    return creditAllowanceFor(sub);
  },

  planFromSubscription(sub: any | null): PlanId {
    return planFromSubscription(sub);
  },

  async isTrialCapped(userId: string): Promise<boolean> {
    const sub = await getSubscription(userId);
    return trialCapped(sub) && (sub?.credit_allowance === null || sub?.credit_allowance === undefined);
  },

  /** The plan's limits (as the owners have set them), then this account's own overrides. */
  async getLimits(userId: string): Promise<PlanLimits> {
    const [planId, suspended, own] = await Promise.all([
      this.getPlanId(userId), accountControls.isSuspended(userId), accountControls.overrides(userId), platformSettings.get(),
    ]);
    if (suspended) return SUSPENDED_LIMITS;
    const plan = PLANS[planId];
    const n = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
    return {
      ...plan,
      maxInboxes: n(own.limits.maxInboxes, plan.maxInboxes),
      emailsPerMonth: n(own.limits.emailsPerMonth, plan.emailsPerMonth),
      features: { ...plan.features, ...Object.fromEntries(Object.entries(own.features).filter(([, v]) => typeof v === 'boolean')) },
    };
  },

  async hasFeature(userId: string, feature: keyof PlanFeatures): Promise<boolean> {
    const limits = await this.getLimits(userId);
    return !!limits.features[feature];
  },

  async countInboxes(userId: string): Promise<number> {
    const { count } = await supabaseAdmin
      .from('smtp_accounts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    return count || 0;
  },

  /** Throws a 403 AppError if the user is at their inbox cap. */
  async assertCanAddInbox(userId: string): Promise<void> {
    const limits = await this.getLimits(userId);
    if (limits.maxInboxes < 0) return; // unlimited
    const current = await this.countInboxes(userId);
    if (current >= limits.maxInboxes) {
      throw new AppError(
        `Your plan allows up to ${plural(limits.maxInboxes, 'sending inbox', 'sending inboxes')}. Upgrade your plan to connect more.`,
        403,
        'UPGRADE_REQUIRED',
      );
    }
  },

  async getEmailsSentThisPeriod(userId: string): Promise<number> {
    const { data } = await supabaseAdmin
      .from('usage_counters')
      .select('emails_sent')
      .eq('user_id', userId)
      .eq('period_start', currentPeriodStart())
      .maybeSingle();
    return (data?.emails_sent as number) || 0;
  },

  /** False when the user has hit their monthly email cap. */
  async hasEmailQuota(userId: string): Promise<boolean> {
    if (await accountControls.isSendingPaused(userId)) return false;
    const limits = await this.getLimits(userId);
    if (limits.emailsPerMonth < 0) return true; // unlimited
    const sent = await this.getEmailsSentThisPeriod(userId);
    return sent < limits.emailsPerMonth;
  },

  /**
   * Atomically reserve one email against the monthly cap. Returns true if the
   * send is allowed (and counts it), false if it would exceed the limit. Use
   * this on every real send path so the cap can't be raced or bypassed.
   */
  async reserveEmailQuota(userId: string): Promise<boolean> {
    // The owner's hold on an account's sending stops every send path here.
    if (await accountControls.isSendingPaused(userId)) return false;
    const limits = await this.getLimits(userId);
    const { data, error } = await supabaseAdmin.rpc('reserve_email_quota', {
      p_user_id: userId,
      p_limit: limits.emailsPerMonth,
      p_count: 1,
    });
    if (!error) return data === true;
    // The atomic RPC is required to enforce the cap without a race. If it's
    // missing (e.g. migration 020 not applied), fail closed rather than
    // falling back to a non-atomic check+increment that concurrent sends
    // could race past the plan's email cap.
    console.error(`[Billing] reserve_email_quota RPC unavailable, denying send: ${error.message}`);
    return false;
  },

  /**
   * Return a reserved-but-unused quota slot (e.g. the send failed after the
   * slot was reserved), so failed sends don't burn the monthly cap.
   */
  async refundEmailQuota(userId: string, count = 1): Promise<void> {
    const { error } = await supabaseAdmin.rpc('increment_email_usage', {
      p_user_id: userId,
      p_count: -count,
    });
    if (error) {
      console.error(`[Billing] Failed to refund email quota for ${userId}: ${error.message}`);
    }
  },

  async incrementEmailUsage(userId: string, count = 1): Promise<void> {
    const { error } = await supabaseAdmin.rpc('increment_email_usage', {
      p_user_id: userId,
      p_count: count,
    });
    if (error) {
      console.error(`[Billing] Failed to increment email usage for ${userId}: ${error.message}`);
    }
  },

  async getUsageSummary(userId: string): Promise<UsageSummary> {
    const sub = await getSubscription(userId);
    const planId = planFromSubscription(sub);
    const plan = PLANS[planId];
    // The limits shown are the ones enforced: the owners' numbers and this account's overrides.
    const [emailsSent, inboxes, limits] = await Promise.all([
      this.getEmailsSentThisPeriod(userId),
      this.countInboxes(userId),
      this.getLimits(userId),
    ]);
    return {
      plan: planId,
      planName: plan.name,
      status: (sub?.status as SubscriptionStatus) || 'free',
      trialEndsAt: sub?.trial_ends_at ?? null,
      periodStart: currentPeriodStart(),
      currentPeriodEnd: sub?.current_period_end ?? null,
      emailsSent,
      emailsLimit: limits.emailsPerMonth,
      inboxes,
      inboxLimit: limits.maxInboxes,
      features: limits.features,
      hasBilling: !!sub?.stripe_customer_id,
    };
  },
};

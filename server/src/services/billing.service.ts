import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import {
  PLANS,
  type PlanId,
  type PlanLimits,
  type PlanFeatures,
  type SubscriptionStatus,
  type UsageSummary,
} from '@lemlist/shared';

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
  const { data } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  return data ?? null;
}

function planFromSubscription(sub: any | null): PlanId {
  if (!sub) return DEFAULT_PLAN;
  const status = sub.status as SubscriptionStatus;
  if (status === 'active' || status === 'trialing') {
    return PLANS[sub.plan as PlanId] ? (sub.plan as PlanId) : DEFAULT_PLAN;
  }
  // past_due / canceled / incomplete → drop back to Free until they pay.
  return 'free';
}

export const billingService = {
  async getPlanId(userId: string): Promise<PlanId> {
    return planFromSubscription(await getSubscription(userId));
  },

  async getLimits(userId: string): Promise<PlanLimits> {
    return PLANS[await this.getPlanId(userId)];
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
        `Your plan allows up to ${limits.maxInboxes} sending inbox(es). Upgrade your plan to connect more.`,
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
    const limits = await this.getLimits(userId);
    if (limits.emailsPerMonth < 0) return true; // unlimited
    const sent = await this.getEmailsSentThisPeriod(userId);
    return sent < limits.emailsPerMonth;
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
    const [emailsSent, inboxes] = await Promise.all([
      this.getEmailsSentThisPeriod(userId),
      this.countInboxes(userId),
    ]);
    return {
      plan: planId,
      planName: plan.name,
      status: (sub?.status as SubscriptionStatus) || 'free',
      trialEndsAt: sub?.trial_ends_at ?? null,
      periodStart: currentPeriodStart(),
      emailsSent,
      emailsLimit: plan.emailsPerMonth,
      inboxes,
      inboxLimit: plan.maxInboxes,
      features: plan.features,
      hasBilling: !!sub?.stripe_customer_id,
    };
  },
};

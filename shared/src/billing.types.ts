// Billing: plan definitions, limits, and usage types.
// This is the single source of truth for plan limits, shared by client + server.

export type PlanId = 'free' | 'trial' | 'starter' | 'growth' | 'scale';

export interface PlanFeatures {
  /** SARA autonomous reply agent */
  sara: boolean;
  /** A/B subject & body testing */
  abTesting: boolean;
}

export interface PlanLimits {
  /** Max connected sending inboxes. -1 = unlimited. */
  maxInboxes: number;
  /** Max emails sent per calendar month. -1 = unlimited. */
  emailsPerMonth: number;
  features: PlanFeatures;
}

export interface PlanInfo extends PlanLimits {
  id: PlanId;
  name: string;
  /** USD/month on the monthly plan; null = sales-led (contact us). */
  priceMonthly: number | null;
  /** Total USD/year on the annual plan; null = sales-led. */
  priceAnnual: number | null;
}

export const PLANS: Record<PlanId, PlanInfo> = {
  free: {
    id: 'free', name: 'Free', priceMonthly: 0, priceAnnual: 0,
    maxInboxes: 1, emailsPerMonth: 100,
    features: { sara: false, abTesting: false },
  },
  trial: {
    id: 'trial', name: 'Trial', priceMonthly: 0, priceAnnual: 0,
    maxInboxes: 25, emailsPerMonth: 15000,
    features: { sara: true, abTesting: true },
  },
  starter: {
    id: 'starter', name: 'Starter', priceMonthly: 39, priceAnnual: 348,
    maxInboxes: 3, emailsPerMonth: 1500,
    features: { sara: false, abTesting: false },
  },
  growth: {
    id: 'growth', name: 'Growth', priceMonthly: 59, priceAnnual: 499,
    maxInboxes: 25, emailsPerMonth: 15000,
    features: { sara: true, abTesting: true },
  },
  scale: {
    id: 'scale', name: 'Scale', priceMonthly: null, priceAnnual: null,
    maxInboxes: -1, emailsPerMonth: -1,
    features: { sara: true, abTesting: true },
  },
};

export type SubscriptionStatus =
  | 'free'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete';

export interface Subscription {
  user_id: string;
  plan: PlanId;
  status: SubscriptionStatus;
  trial_ends_at: string | null;
  current_period_end: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

export interface UsageSummary {
  plan: PlanId;
  planName: string;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  /** ISO date (YYYY-MM-DD) of the start of the current usage period. */
  periodStart: string;
  emailsSent: number;
  /** -1 = unlimited */
  emailsLimit: number;
  inboxes: number;
  /** -1 = unlimited */
  inboxLimit: number;
  features: PlanFeatures;
  /** True once the user has a Stripe customer (can open the billing portal). */
  hasBilling: boolean;
}

/** True when a limit value represents "unlimited". */
export function isUnlimited(limit: number): boolean {
  return limit < 0;
}

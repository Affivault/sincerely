// Billing: plan definitions, limits, and usage types.
// This is the single source of truth for plan limits, shared by client + server.

export type PlanId = 'free' | 'trial' | 'starter' | 'growth' | 'scale' | 'lifetime';

export interface PlanFeatures {
  /** Relay autonomous reply agent */
  sara: boolean;
  /** A/B subject & body testing */
  abTesting: boolean;
}

export interface PlanLimits {
  /** Max connected sending inboxes. -1 = unlimited. */
  maxInboxes: number;
  /** Max emails sent per calendar month. -1 = unlimited. */
  emailsPerMonth: number;
  /** Credits per calendar month (see credits.types.ts for prices). -1 = unlimited. */
  prospectCredits: number;
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
    maxInboxes: 1, emailsPerMonth: 100, prospectCredits: 25,
    features: { sara: false, abTesting: false },
  },
  trial: {
    id: 'trial', name: 'Trial', priceMonthly: 0, priceAnnual: 0,
    maxInboxes: 25, emailsPerMonth: 15000, prospectCredits: 100,
    features: { sara: true, abTesting: true },
  },
  starter: {
    id: 'starter', name: 'Starter', priceMonthly: 39, priceAnnual: 348,
    maxInboxes: 3, emailsPerMonth: 1500, prospectCredits: 250,
    features: { sara: false, abTesting: false },
  },
  growth: {
    id: 'growth', name: 'Growth', priceMonthly: 59, priceAnnual: 499,
    maxInboxes: 25, emailsPerMonth: 15000, prospectCredits: 1000,
    features: { sara: true, abTesting: true },
  },
  // Credits are a real cost on every plan, so none is unlimited. A Scale
  // deal sets its own number in subscriptions.credit_allowance.
  scale: {
    id: 'scale', name: 'Scale', priceMonthly: null, priceAnnual: null,
    maxInboxes: -1, emailsPerMonth: -1, prospectCredits: 5000,
    features: { sara: true, abTesting: true },
  },
  // Manually granted only (never sold through checkout): overrides every
  // limit but credits (Growth's 1,000 a month), forever. Grant via SQL: set subscriptions.plan = 'lifetime'.
  lifetime: {
    id: 'lifetime', name: 'Lifetime', priceMonthly: null, priceAnnual: null,
    maxInboxes: -1, emailsPerMonth: -1, prospectCredits: 1000,
    features: { sara: true, abTesting: true },
  },
};

export type SubscriptionStatus =
  | 'free'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid'
  | 'paused';

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
  /** ISO datetime the paid period renews (next payment); null if not subscribed. */
  currentPeriodEnd: string | null;
  emailsSent: number;
  /** -1 = unlimited */
  emailsLimit: number;
  inboxes: number;
  /** -1 = unlimited */
  inboxLimit: number;
  features: PlanFeatures;
  /** True once the user has a Stripe customer (can open the billing portal). */
  hasBilling: boolean;
  /** Present, and true, for the platform owner only. Nobody else is told it exists. */
  isOwner?: true;
}

/** True when a limit value represents "unlimited". */
export function isUnlimited(limit: number): boolean {
  return limit < 0;
}

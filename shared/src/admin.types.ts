// Admin console — platform-owner only. Who the owner is lives on the server
// (server/src/config/admin.ts), never in the shared package or the client.

import type { PlanFeatures, PlanId } from './billing.types.js';
import type { CreditAction } from './credits.types.js';

export interface AdminUserRow {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed: boolean;
  plan: string;
  status: string;
}

export interface AdminStats {
  total_users: number;
  lifetime_users: number;
  paying_users: number;
  free_users: number;
  mailboxes: number;
  domains: number;
  contacts: number;
  campaigns: number;
  /** On a Stripe trial now. */
  trialing_users: number;
  /** A payment failed and Stripe is retrying. */
  past_due_users: number;
  /** Signed in during the last 7 days. */
  active_7d: number;
  /** Signed up in the last 30 days. */
  signups_30d: number;
  /** Monthly recurring revenue at list price: each active paid plan's monthly price. */
  est_mrr_usd: number;
}

export interface AdminBillingPayment {
  id: string;
  user_id: string | null;
  email: string | null;
  kind: string;
  amount_usd: number;
  stripe_ref: string;
  paid_at: string;
}

export interface AdminBillingReport {
  month: string;
  payments: AdminBillingPayment[];
  totals: { gross_usd: number; refunds_usd: number; net_usd: number; fees_usd: number; count: number };
  plan_mix: Array<{ plan: string; status: string; count: number }>;
  est_mrr_usd: number;
  /** Accounts whose last payment failed. */
  past_due: Array<{ id: string; email: string; plan: string }>;
  revenue_synced: boolean;
}

export interface AdminUsersResponse {
  users: AdminUserRow[];
  total: number;
}

/* ─── The admin backend: accounts ─────────────────────────────────────── */

/** One row of GET /admin/accounts. Money is this month unless it says lifetime. */
export interface AdminAccountRow {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed: boolean;
  plan: string;
  status: string;
  /** The plan the account is actually on, after status (a past_due Growth is Free). */
  effective_plan: string;
  suspended: boolean;
  has_stripe: boolean;
  /** Credits charged this month, net of refunds. */
  credits_used: number;
  /** This month's allowance; 0 while suspended. */
  credit_allowance: number;
  /** True when the allowance was set by hand rather than coming from the plan. */
  custom_allowance: boolean;
  cost_usd: number;
  revenue_usd: number;
  profit_usd: number;
  lifetime_revenue_usd: number;
  lifetime_profit_usd: number;
  losing: boolean;
}

export interface AdminAccountsResponse {
  month: string;
  accounts: AdminAccountRow[];
  /** False until migration 101 is run: suspension, notes and the log need it. */
  controls_ready: boolean;
}

export interface AdminMonthRow {
  month: string;
  credits_used: number;
  provider_credits: number;
  cost_usd: number;
  revenue_usd: number;
  fees_usd: number;
  profit_usd: number;
}

export interface AdminLedgerRow {
  id: string;
  delta: number;
  kind: string;
  bucket: string;
  action: string | null;
  reason: string | null;
  created_at: string;
}

export interface AdminProviderCall {
  id: string;
  action: string;
  endpoint: string;
  provider_credits: number;
  cost_usd: number;
  created_at: string;
}

export interface AdminPaymentRow {
  id: string;
  kind: string;
  amount_usd: number;
  currency: string;
  stripe_ref: string;
  paid_at: string;
}

export interface AdminAuditEntry {
  id: string;
  actor_email: string;
  action: string;
  target_user_id: string | null;
  target_email: string | null;
  details: Record<string, any>;
  created_at: string;
}

/** GET /admin/accounts/:id */
export interface AdminStripeSummary {
  status: string;
  price_usd: number | null;
  interval: string | null;
  cancel_at_period_end: boolean;
  cancel_at: string | null;
  trial_end: string | null;
  current_period_end: string | null;
  discount: string | null;
  /** Credit on their Stripe balance, taken off their next invoices. */
  balance_usd: number;
}

export interface AdminAccountDetail {
  account: AdminAccountRow;
  subscription: {
    plan: string;
    status: string;
    trial_ends_at: string | null;
    current_period_end: string | null;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    credit_allowance: number | null;
  } | null;
  controls: {
    suspended_at: string | null;
    suspended_reason: string | null;
    note: string | null;
    /** Set when the owner signed them out everywhere (migration 102). */
    sessions_revoked_at: string | null;
    /** While set, nothing of theirs sends (migration 102). */
    sending_paused_at: string | null;
    /** The owner's limits and switches over the plan's (migration 102). */
    overrides: AccountOverrides;
  };
  /** The plan's own limits, before this account's overrides. */
  plan_limits: { maxInboxes: number; emailsPerMonth: number; features: PlanFeatures };
  /** What Stripe says right now, when they have a subscription there and Stripe answered. */
  stripe: AdminStripeSummary | null;
  /** Running or scheduled campaigns. */
  live_campaigns: number;
  credits: {
    allowance: number;
    used: number;
    plan_remaining: number;
    /** Bonus credits: granted by hand (or bought before packs were withdrawn). Never expire. */
    bonus: number;
    remaining: number;
    resets_at: string;
  };
  emails: { sent: number; limit: number; inboxes: number; inbox_limit: number };
  totals: {
    lifetime_revenue_usd: number;
    lifetime_cost_usd: number;
    lifetime_fees_usd: number;
    lifetime_profit_usd: number;
    lifetime_credits_used: number;
  };
  /** Newest month first, six months. */
  months: AdminMonthRow[];
  ledger: AdminLedgerRow[];
  calls: AdminProviderCall[];
  payments: AdminPaymentRow[];
  resources: { mailboxes: number; domains: number; contacts: number; campaigns: number };
  audit: AdminAuditEntry[];
  controls_ready: boolean;
}

/** POST /admin/accounts/:id/{plan,allowance,credits,suspend,unsuspend,note} */
export interface AdminPlanChange { plan: string; status?: string }
export interface AdminAllowanceChange { credit_allowance: number | null }
export interface AdminCreditAdjustment { amount: number; note: string }
export interface AdminSuspend { reason?: string }
export interface AdminNote { note: string }

export interface AdminAuditResponse {
  entries: AdminAuditEntry[];
  controls_ready: boolean;
}

/* ─── Platform settings: changed by the owners without a deploy ────────── */

export type SignupMode = 'open' | 'invite' | 'closed';

/** One plan's numbers as the owners have set them; anything left out is the plan's default. */
export interface PlanOverride {
  maxInboxes?: number;
  emailsPerMonth?: number;
  prospectCredits?: number;
}

export interface Announcement {
  /** Changes whenever the text does, so a dismissed banner comes back for a new one. */
  id: string;
  text: string;
  tone: 'info' | 'warn';
  link_url?: string | null;
  link_label?: string | null;
}

export interface PlatformSettings {
  plans: Partial<Record<PlanId, PlanOverride>>;
  credit_prices: Partial<Record<CreditAction, number>>;
  signups: { mode: SignupMode; allow: string[] };
  announcement: Announcement | null;
  /** While set, nothing sends on the whole platform. */
  kill_switch: { reason: string; at: string; by: string } | null;
}

/** GET /admin/settings: what is set, beside the defaults it overrides. */
export interface AdminSettingsResponse {
  settings: PlatformSettings;
  defaults: { plans: Record<PlanId, PlanOverride & { name: string }>; credit_prices: Record<CreditAction, number> };
  ready: boolean;
  updated: Partial<Record<keyof PlatformSettings, { by: string | null; at: string }>>;
}

/** GET /api/platform: what the app needs before anyone signs in. */
export interface PublicPlatformInfo {
  signups: SignupMode;
  announcement: Announcement | null;
  credit_prices: Record<CreditAction, number>;
  plans: Record<PlanId, Required<PlanOverride>>;
}

/** Per-account limits and feature switches over the plan's. */
export interface AccountOverrides {
  limits: { maxInboxes?: number; emailsPerMonth?: number };
  features: Partial<Record<keyof PlanFeatures, boolean>>;
}

/* ─── Sending and safety, across every account ─────────────────────────── */

export interface AdminMailboxRow {
  id: string;
  user_id: string;
  email: string;
  owner_email: string | null;
  is_active: boolean;
  is_verified: boolean;
  autopilot_state: string | null;
  sent: number;
  bounced: number;
  complained: number;
  bounce_rate: number;
  complaint_rate: number;
  flagged: boolean;
}

export interface AdminDomainRow {
  id: string;
  user_id: string;
  domain: string;
  owner_email: string | null;
  spf_ok: boolean | null;
  dkim_ok: boolean | null;
  dmarc_ok: boolean | null;
  last_checked_at: string | null;
}

export interface AdminRiskyAccount {
  id: string;
  email: string;
  sent: number;
  bounce_rate: number;
  complaint_rate: number;
  reasons: string[];
  held: boolean;
}

export interface AdminSendingReport {
  days: number;
  totals: { sent: number; bounced: number; complained: number; bounce_rate: number; complaint_rate: number; mailboxes: number; paused_mailboxes: number };
  mailboxes: AdminMailboxRow[];
  domains: AdminDomainRow[];
  risky: AdminRiskyAccount[];
  kill_switch: PlatformSettings['kill_switch'];
  /** Thresholds a mailbox or account is flagged at, as fractions. */
  thresholds: { bounce: number; complaint: number; min_sent: number };
}

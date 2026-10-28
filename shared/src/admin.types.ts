// Admin console — platform-owner only. Who the owner is lives on the server
// (server/src/config/admin.ts), never in the shared package or the client.

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
  };
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

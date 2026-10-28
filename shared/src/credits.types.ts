// Credits: what each paid action costs, and the usage reports built on them.
// Credits go to one decimal place. A credit is spent only when Sincerely
// itself pays the data provider for the action, so free things stay free.

import type { ProspectCreditsSummary } from './prospecting.types.js';

export type CreditAction = 'search' | 'reveal' | 'verify' | 'enrich';

/** The price list, in credits. */
export const CREDIT_PRICES: Record<CreditAction, number> = {
  search: 0.5,
  reveal: 1,
  verify: 0.1,
  enrich: 2,
};

export interface CreditPriceRow {
  action: CreditAction;
  label: string;
  price: number;
  note: string;
}

export const CREDIT_PRICE_LIST: CreditPriceRow[] = [
  { action: 'search', label: 'Search: each new page of 25 people', price: CREDIT_PRICES.search, note: 'Pages loaded in the last 10 minutes and match counts are free.' },
  { action: 'reveal', label: 'Find a work email', price: CREDIT_PRICES.reveal, note: 'Only when an email is found. People you already revealed are free.' },
  { action: 'verify', label: 'Verify an email (deep check)', price: CREDIT_PRICES.verify, note: 'Only when the free checks cannot settle it.' },
  { action: 'enrich', label: 'Enrich a contact', price: CREDIT_PRICES.enrich, note: 'Refunded when nothing is found.' },
];

/** What to say when a deep email check was skipped for want of credits. */
export function deepCheckSkipped(n = 1): string {
  return n === 1
    ? `You're out of credits, so only the free checks ran. The deep check costs ${CREDIT_PRICES.verify} credit.`
    : `You're out of credits, so ${n} addresses had only the free checks. The deep check costs ${CREDIT_PRICES.verify} credit each.`;
}

/** Credits a Stripe trial gets until its first payment, whatever the plan. */
export const TRIAL_CREDIT_CAP = 100;

export const CREDIT_ACTION_LABELS: Record<string, string> = {
  search: 'Searches',
  reveal: 'Emails found',
  verify: 'Deep checks',
  enrich: 'Enrichments',
  topup: 'Credit packs',
  adjustment: 'Credit adjustments',
  other: 'Other',
};

/** 0.5 -> "0.5", 12 -> "12", 1000 -> "1,000". Ledger sums can carry float noise. */
export function formatCredits(n: number): string {
  const rounded = Math.round((Number(n) || 0) * 10) / 10;
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

/** "1 credit", "0.5 credits". */
export function creditsLabel(n: number): string {
  return `${formatCredits(n)} ${Math.round(n * 10) === 10 ? 'credit' : 'credits'}`;
}

export interface CreditLedgerEntry {
  id: string;
  /** Negative for a spend, positive for a refund or grant. */
  delta: number;
  kind: 'spend' | 'refund' | 'topup' | 'adjustment' | string;
  action: string | null;
  reason: string | null;
  created_at: string;
}

export interface CreditActionTotal {
  action: string;
  /** Net credits spent this month (spends minus refunds). */
  credits: number;
  /** Charged actions this month (refunded ones excluded). */
  count: number;
}

/** GET /billing/credits */
export interface CreditUsageReport {
  credits: ProspectCreditsSummary;
  prices: CreditPriceRow[];
  /** True while a Stripe trial is capped at TRIAL_CREDIT_CAP. */
  trial_capped: boolean;
  by_action: CreditActionTotal[];
  history: CreditLedgerEntry[];
}

/* ─── Admin: usage and profit ─────────────────────────────────────────── */

export interface AdminUsageUserRow {
  user_id: string;
  email: string;
  plan: string;
  status: string;
  /** Credits charged this month, net of refunds. */
  credits_charged: number;
  /** Icypeas credits burned on their behalf. */
  provider_credits: number;
  cost_usd: number;
  revenue_usd: number;
  /** Estimated Stripe fees on that revenue (2.9% + $0.30 a payment). */
  fees_usd: number;
  profit_usd: number;
  /** Cost above revenue. */
  losing: boolean;
}

export interface AdminUsageActionRow {
  action: string;
  calls: number;
  provider_credits: number;
  cost_usd: number;
  credits_charged: number;
}

export interface AdminProviderBalance {
  /** Icypeas credits left on our account; null when it could not be read. */
  credits: number | null;
  low: boolean;
  /** Why the balance is missing, when it is. */
  note: string | null;
}

/** GET /admin/usage?month=YYYY-MM */
export interface AdminUsageReport {
  month: string;
  usd_per_provider_credit: number;
  totals: {
    provider_credits: number;
    cost_usd: number;
    revenue_usd: number;
    fees_usd: number;
    profit_usd: number;
    credits_charged: number;
  };
  /** Cost and credits for calls not tied to an account (background work). */
  unattributed_cost_usd: number;
  by_action: AdminUsageActionRow[];
  users: AdminUsageUserRow[];
  provider_balance: AdminProviderBalance;
  /** Revenue is read from Stripe when the page loads; false when Stripe could not be reached. */
  revenue_synced: boolean;
}

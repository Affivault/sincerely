/* ═══════════════════════════════════════════════════════════════════════
   What Relay's AI costs, and where it stops.

   Every Claude call is counted per account, per calendar month (UTC), per
   feature. An account has a monthly token allowance; once it is used up,
   Relay goes on working on its keyword rules and templates - exactly as it
   does with no API key - until the month turns. Nothing stops sending and
   nothing errors.

   Old mail is never worth paying to read: a six-month inbox backfill would
   otherwise send every historical reply to Claude. Only replies received in
   the last AI_FRESH_DAYS are read by Claude; older ones get the rules.
   ═══════════════════════════════════════════════════════════════════════ */

export const AI_FEATURES = ['read_reply', 'draft_reply', 'write_sequence', 'first_lines'] as const;
export type AiFeature = typeof AI_FEATURES[number];

export const AI_FEATURE_LABELS: Record<AiFeature, string> = {
  read_reply: 'Reading replies',
  draft_reply: 'Drafting answers',
  write_sequence: 'Writing sequences',
  first_lines: 'Personal first lines',
};

/** Replies older than this are read by the rules, never by Claude. */
export const AI_FRESH_DAYS = 14;

/** The server's ceiling when it sets none. About 1,000 replies read. */
export const DEFAULT_AI_MONTHLY_TOKENS = 5_000_000;

/** The allowances offered in Settings, below whatever the server allows. */
export const AI_CAP_CHOICES = [250_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000, 25_000_000] as const;

/**
 * The allowance that applies. The server's ceiling (AI_MONTHLY_TOKEN_CAP)
 * protects whoever pays for the API key; an account may choose less, never
 * more. 0 means no limit, for either.
 */
export function effectiveAiCap(accountCap: number | null | undefined, ceiling: number): number {
  const own = accountCap == null || accountCap < 0 ? null : accountCap;
  if (own === null || own === 0) return ceiling;
  if (!ceiling) return own;
  return Math.min(own, ceiling);
}

/** The choices an account may pick from, given the server's ceiling. */
export function aiCapChoices(ceiling: number): number[] {
  const list: number[] = AI_CAP_CHOICES.filter((c) => !ceiling || c < ceiling);
  if (ceiling) list.push(ceiling);
  return list;
}

export type AiCapState = 'ok' | 'near' | 'reached' | 'unlimited';

export interface AiUsageRow {
  feature: AiFeature;
  calls: number;
  input_tokens: number;
  output_tokens: number;
}

export interface AiUsage {
  /** False when Claude is not configured on the server. */
  available: boolean;
  /** False when migration 079 is not applied: counted since the last restart only. */
  persisted: boolean;
  month: string;
  /** First moment of next month, when the allowance starts again. */
  resets_at: string;
  used_tokens: number;
  calls: number;
  /** The allowance that applies. 0 = no limit. */
  cap_tokens: number;
  /** The most the server allows an account. 0 = no limit. */
  ceiling_tokens: number;
  /** Whether the account chose a lower allowance than the ceiling. */
  cap_is_custom: boolean;
  state: AiCapState;
  by_feature: AiUsageRow[];
  /** Estimated spend in USD, only when the server knows its prices. */
  cost_usd: number | null;
  fresh_days: number;
}

/** "2026-09" for any moment in September 2026, UTC. */
export function monthKey(at: Date | number = Date.now()): string {
  const d = new Date(at);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function nextMonthStart(at: Date | number = Date.now()): string {
  const d = new Date(at);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}

/** Near from 80%; reached at the cap. A cap of 0 is no limit. */
export function aiCapState(used: number, cap: number): AiCapState {
  if (!cap || cap <= 0) return 'unlimited';
  if (used >= cap) return 'reached';
  if (used >= cap * 0.8) return 'near';
  return 'ok';
}

/** Whether a call may go to Claude now. */
export function aiAllowed(used: number, cap: number): boolean {
  return aiCapState(used, cap) !== 'reached';
}

/** Whether a reply is recent enough to be worth reading with Claude. */
export function freshEnoughForAi(receivedAt: string | null | undefined, now = Date.now()): boolean {
  if (!receivedAt) return true;
  const t = Date.parse(receivedAt);
  if (!Number.isFinite(t)) return true;
  return now - t <= AI_FRESH_DAYS * 86_400_000;
}

/** "1.2M", "850k", "940". */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.max(0, Math.round(n)));
}

/** Estimated USD, given prices per million input and output tokens. */
export function estimateCost(rows: AiUsageRow[], inPerM: number, outPerM: number): number {
  let usd = 0;
  for (const r of rows) usd += (r.input_tokens / 1e6) * inPerM + (r.output_tokens / 1e6) * outPerM;
  return Math.round(usd * 100) / 100;
}

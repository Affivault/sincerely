/* ═══════════════════════════════════════════════════════════════════════
   Counting Relay's Claude calls, and stopping at the allowance.

   Every call is checked before it goes (allow) and counted after it comes
   back (record). The month's total is cached for a minute per account and
   bumped in place on every record, so a burst of replies arriving in one
   sync does not read the database once per reply, and still stops close to
   the allowance rather than a minute after it.

   Counted in ai_usage (migration 079). Without that table the counts live
   in memory, so the cap still holds on this server until it restarts.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { AppError } from '../middleware/error.middleware.js';
import { settingsService } from './settings.service.js';
import {
  AI_FEATURES, AI_FRESH_DAYS, aiAllowed, aiCapState, effectiveAiCap, estimateCost, monthKey, nextMonthStart,
  type AiFeature, type AiUsage, type AiUsageRow,
} from '@lemlist/shared';

const CACHE_MS = 60_000;

interface Tally { month: string; used: number; cap: number; at: number }
const tallies = new Map<string, Tally>();
/** Fallback counters when the table is missing: user|month|feature -> row. */
const memory = new Map<string, AiUsageRow>();
let tableMissing = false;
const warnedCap = new Set<string>();

function ceiling(): number {
  return env.AI_MONTHLY_TOKEN_CAP ?? 0;
}

async function accountCap(userId: string): Promise<{ own: number | null; cap: number }> {
  let own: number | null = null;
  const { data, error } = await supabaseAdmin
    .from('user_settings').select('ai_monthly_token_cap').eq('user_id', userId).maybeSingle();
  // A database without the column reads as "no choice made".
  if (!error && data && (data as any).ai_monthly_token_cap != null) own = Number((data as any).ai_monthly_token_cap);
  return { own, cap: effectiveAiCap(own, ceiling()) };
}

async function rowsFor(userId: string, month: string): Promise<{ rows: AiUsageRow[]; persisted: boolean }> {
  if (!tableMissing) {
    const { data, error } = await supabaseAdmin
      .from('ai_usage')
      .select('feature, calls, input_tokens, output_tokens')
      .eq('user_id', userId)
      .eq('month', month);
    if (!error) {
      return {
        persisted: true,
        rows: (data || []).map((r: any) => ({
          feature: r.feature, calls: Number(r.calls) || 0,
          input_tokens: Number(r.input_tokens) || 0, output_tokens: Number(r.output_tokens) || 0,
        })),
      };
    }
    if (/ai_usage/.test(error.message)) tableMissing = true;
    else throw new Error(`ai usage: ${error.message}`);
  }
  const rows: AiUsageRow[] = [];
  for (const f of AI_FEATURES) {
    const r = memory.get(`${userId}|${month}|${f}`);
    if (r) rows.push({ ...r });
  }
  return { rows, persisted: false };
}

const total = (rows: AiUsageRow[]) => rows.reduce((n, r) => n + r.input_tokens + r.output_tokens, 0);

async function tally(userId: string, now = Date.now()): Promise<Tally> {
  const month = monthKey(now);
  const hit = tallies.get(userId);
  if (hit && hit.month === month && now - hit.at < CACHE_MS) return hit;
  const [{ rows }, { cap }] = await Promise.all([rowsFor(userId, month), accountCap(userId)]);
  const t: Tally = { month, used: total(rows), cap, at: now };
  tallies.set(userId, t);
  return t;
}

export const aiUsageService = {
  /**
   * Whether this account may make another Claude call now. Any failure to
   * find out answers yes - a usage table that cannot be read must not take
   * Relay's AI away - except that a known-exhausted allowance stays shut.
   */
  async allow(userId: string | null | undefined): Promise<boolean> {
    if (!userId) return false;
    try {
      const t = await tally(userId);
      const ok = aiAllowed(t.used, t.cap);
      const warnKey = `${userId}|${t.month}`;
      if (!ok && !warnedCap.has(warnKey)) {
        warnedCap.add(warnKey);
        console.warn(`[Relay AI] ${userId}: monthly allowance used (${t.used}/${t.cap} tokens) - rules until ${nextMonthStart().slice(0, 10)}`);
      }
      return ok;
    } catch (err: any) {
      console.warn('[Relay AI] usage check failed, allowing:', err?.message || err);
      const hit = tallies.get(userId);
      return !hit || aiAllowed(hit.used, hit.cap);
    }
  },

  /** Count one call. Never throws: a count that cannot be written must not lose the answer. */
  async record(userId: string, feature: AiFeature, usage: { input_tokens?: number | null; output_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null } | null | undefined): Promise<void> {
    const input = (usage?.input_tokens || 0) + (usage?.cache_creation_input_tokens || 0) + (usage?.cache_read_input_tokens || 0);
    const output = usage?.output_tokens || 0;
    const month = monthKey();
    const t = tallies.get(userId);
    if (t && t.month === month) t.used += input + output;

    if (!tableMissing) {
      const { error } = await supabaseAdmin.rpc('record_ai_usage', {
        p_user_id: userId, p_month: month, p_feature: feature, p_input: input, p_output: output,
      });
      if (!error) return;
      if (/record_ai_usage|ai_usage/.test(error.message)) tableMissing = true;
      else { console.warn('[Relay AI] usage not recorded:', error.message); return; }
    }
    const key = `${userId}|${month}|${feature}`;
    const row = memory.get(key) || { feature, calls: 0, input_tokens: 0, output_tokens: 0 };
    row.calls += 1; row.input_tokens += input; row.output_tokens += output;
    memory.set(key, row);
  },

  /** This month, for the meter in Settings. */
  async usage(userId: string, available: boolean): Promise<AiUsage> {
    const now = Date.now();
    const month = monthKey(now);
    const [{ rows, persisted }, { own, cap }] = await Promise.all([rowsFor(userId, month), accountCap(userId)]);
    const used = total(rows);
    tallies.set(userId, { month, used, cap, at: now });
    const inP = env.AI_INPUT_USD_PER_MTOK, outP = env.AI_OUTPUT_USD_PER_MTOK;
    return {
      available,
      persisted,
      month,
      resets_at: nextMonthStart(now),
      used_tokens: used,
      calls: rows.reduce((n, r) => n + r.calls, 0),
      cap_tokens: cap,
      ceiling_tokens: ceiling(),
      cap_is_custom: own != null && own > 0 && cap === own && cap !== ceiling(),
      state: aiCapState(used, cap),
      by_feature: AI_FEATURES.map((f) => rows.find((r) => r.feature === f) || { feature: f, calls: 0, input_tokens: 0, output_tokens: 0 }),
      cost_usd: inP != null && outP != null ? estimateCost(rows, inP, outP) : null,
      fresh_days: AI_FRESH_DAYS,
    };
  },

  /**
   * Choose a lower allowance, or null to go back to the server's ceiling.
   * Anything above the ceiling is held to it when read, so it is refused here.
   */
  async setCap(userId: string, cap: number | null): Promise<void> {
    const max = ceiling();
    if (cap !== null && (!Number.isFinite(cap) || cap <= 0 || !Number.isInteger(cap))) {
      throw new AppError('Choose a whole number of tokens above zero.', 400);
    }
    if (cap !== null && max && cap > max) {
      throw new AppError(`This server allows at most ${max.toLocaleString()} tokens a month.`, 400);
    }
    // Makes sure the row exists, with every default, before it is changed.
    await settingsService.get(userId);
    const { error } = await supabaseAdmin
      .from('user_settings')
      .update({ ai_monthly_token_cap: cap, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (error) {
      if (/ai_monthly_token_cap/.test(error.message)) throw new AppError('Run migration 079 to choose an allowance.', 409);
      throw new AppError(error.message, 500);
    }
    tallies.delete(userId);
  },
};

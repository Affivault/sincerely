/* ═══════════════════════════════════════════════════════════════════════
   Standing searches: the pipeline that refills itself.

   A saved Prospector search, run on a cadence. Each run pages through the
   provider's results for people this account has never revealed, and for
   each one - until the rule's daily cap - reveals the address (one credit,
   refunded by the reveal itself when nothing usable comes back), verifies
   it, and enrols it in the rule's campaign through the same door a manual
   enrolment uses, so suppression, open deals and bounces are all honoured.

   Credits are real money, so the cap is a hard ceiling on spend per run
   and running out stops the rule quietly rather than erroring every hour.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { prospectingService } from './prospecting.service.js';
import { verifyContact } from './verification.service.js';
import { campaignContactsService } from './campaign-contacts.service.js';
import { getActiveProvider } from './prospect-providers.js';
import { nextRuleRun, type ProspectRule, type ProspectRuleRunResult, type ProspectRuleCadence } from '@lemlist/shared';

const SELECT = '*, campaign:campaigns(id, name, status)';
const CADENCES: ProspectRuleCadence[] = ['daily', 'weekdays', 'weekly'];
/** Result pages looked through per run, at most. Keeps a run bounded when most results are already known. */
const MAX_PAGES = 6;

function clean(body: any): Record<string, any> {
  const out: Record<string, any> = {};
  if (body.name !== undefined) {
    const name = String(body.name || '').trim().slice(0, 120);
    if (!name) throw new AppError('Give the search a name.', 400);
    out.name = name;
  }
  if (body.filters !== undefined) {
    if (typeof body.filters !== 'object' || body.filters === null) throw new AppError('filters must be an object', 400);
    const f = body.filters;
    const list = (v: unknown) => Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 25) : undefined;
    out.filters = {
      titles: list(f.titles), seniorities: list(f.seniorities), locations: list(f.locations),
      industries: list(f.industries), companies: list(f.companies), companySizes: list(f.companySizes),
      keywords: typeof f.keywords === 'string' ? f.keywords.slice(0, 200) : undefined,
    };
  }
  if (body.campaign_id !== undefined) out.campaign_id = body.campaign_id || null;
  if (body.list_id !== undefined) out.list_id = body.list_id || null;
  if (body.daily_cap !== undefined) {
    const n = Math.round(Number(body.daily_cap));
    if (!Number.isFinite(n) || n < 1 || n > 200) throw new AppError('The daily cap must be between 1 and 200.', 400);
    out.daily_cap = n;
  }
  if (body.cadence !== undefined) {
    if (!CADENCES.includes(body.cadence)) throw new AppError('Cadence must be daily, weekdays or weekly.', 400);
    out.cadence = body.cadence;
  }
  if (body.min_score !== undefined) {
    const n = Math.round(Number(body.min_score));
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new AppError('min_score must be 0-100', 400);
    out.min_score = n;
  }
  if (body.is_active !== undefined) out.is_active = !!body.is_active;
  return out;
}

async function assertTargets(userId: string, row: Record<string, any>) {
  if (row.campaign_id) {
    const { data } = await supabaseAdmin.from('campaigns').select('id').eq('id', row.campaign_id).eq('user_id', userId).maybeSingle();
    if (!data) throw new AppError('Campaign not found', 404);
  }
  if (row.list_id) {
    const { data } = await supabaseAdmin.from('lists').select('id').eq('id', row.list_id).eq('user_id', userId).maybeSingle();
    if (!data) throw new AppError('List not found', 404);
  }
}

function missingTable(err: { message?: string } | null): boolean {
  return !!err && /prospect_rules/.test(err.message || '') && /does not exist|schema cache/.test(err.message || '');
}

export const prospectRulesService = {
  async list(userId: string): Promise<ProspectRule[]> {
    const { data, error } = await supabaseAdmin.from('prospect_rules').select(SELECT)
      .eq('user_id', userId).order('created_at', { ascending: false });
    if (missingTable(error)) throw new AppError('Standing searches need migration 074 to be run first.', 503);
    if (error) throw new AppError(error.message, 500);
    return (data || []) as ProspectRule[];
  },

  async create(userId: string, body: any): Promise<ProspectRule> {
    const row = clean({ daily_cap: 10, cadence: 'daily', min_score: 60, ...body });
    if (!row.name) throw new AppError('Give the search a name.', 400);
    if (!row.filters) throw new AppError('A standing search needs filters.', 400);
    await assertTargets(userId, row);
    const { data, error } = await supabaseAdmin.from('prospect_rules')
      .insert({ ...row, user_id: userId, next_run_at: new Date().toISOString() })
      .select(SELECT).single();
    if (missingTable(error)) throw new AppError('Standing searches need migration 074 to be run first.', 503);
    if (error) throw new AppError(error.message, 500);
    return data as ProspectRule;
  },

  async update(userId: string, id: string, body: any): Promise<ProspectRule> {
    const row = clean(body);
    await assertTargets(userId, row);
    const { data, error } = await supabaseAdmin.from('prospect_rules')
      .update(row).eq('id', id).eq('user_id', userId).select(SELECT).maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Standing search not found', 404);
    return data as ProspectRule;
  },

  async remove(userId: string, id: string): Promise<void> {
    const { error } = await supabaseAdmin.from('prospect_rules').delete().eq('id', id).eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
  },

  /** Run one rule now. Used by the scheduler and by "Run now". */
  async run(userId: string, id: string): Promise<ProspectRuleRunResult> {
    const { data: rule, error } = await supabaseAdmin.from('prospect_rules').select('*')
      .eq('id', id).eq('user_id', userId).maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!rule) throw new AppError('Standing search not found', 404);
    return runRule(rule as ProspectRule);
  },
};

export async function runRule(rule: ProspectRule): Promise<ProspectRuleRunResult> {
  const result: ProspectRuleRunResult = {
    at: new Date().toISOString(), searched: 0, revealed: 0, no_email: 0,
    failed_verification: 0, enrolled: 0, skipped: {}, stopped: 'exhausted',
  };
  const provider = getActiveProvider();
  try {
    if (!provider) { result.stopped = 'no_provider'; return result; }

    // Only a live campaign can take people; a finished one would just collect them.
    let campaignId: string | null = rule.campaign_id;
    if (campaignId) {
      const { data: c } = await supabaseAdmin.from('campaigns').select('status').eq('id', campaignId).maybeSingle();
      if (!c || ['completed', 'cancelled'].includes(c.status)) campaignId = null;
    }

    outer:
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await prospectingService.search(rule.user_id, rule.filters || {}, page);
      result.searched += res.results.length;
      for (const person of res.results) {
        if (result.revealed >= rule.daily_cap) { result.stopped = 'cap'; break outer; }
        if (person.already_revealed) continue;
        let reveal;
        try {
          reveal = await prospectingService.reveal(rule.user_id, {
            provider: provider.id, provider_person_id: person.id, person, list_id: rule.list_id,
          });
        } catch (e: any) {
          if (e?.statusCode === 403 || /credits/i.test(e?.message || '')) { result.stopped = 'no_credits'; break outer; }
          throw e;
        }
        if (!reveal.found || !reveal.contact_id) { result.no_email++; continue; }
        result.revealed++;

        const check = await verifyContact(reveal.contact_id, rule.user_id).catch(() => null);
        if (!check || check.score < (rule.min_score ?? 60)) { result.failed_verification++; continue; }

        if (campaignId) {
          const enrol = await campaignContactsService.add(campaignId, [reveal.contact_id]);
          result.enrolled += enrol.added;
          for (const [reason, n] of Object.entries(enrol.reasons || {})) {
            result.skipped[reason] = (result.skipped[reason] || 0) + (n as number);
          }
        } else if (rule.list_id) {
          // Already added by the reveal; counted as placed.
          result.enrolled++;
        }
      }
      if (res.results.length === 0 || page * 25 >= res.total) break;
    }
  } catch (e: any) {
    result.stopped = 'error';
    result.error = String(e?.message || e).slice(0, 300);
  } finally {
    const now = new Date();
    await supabaseAdmin.from('prospect_rules').update({
      last_run_at: now.toISOString(),
      next_run_at: nextRuleRun(rule.cadence, now).toISOString(),
      last_result: result,
      total_enrolled: (rule.total_enrolled || 0) + result.enrolled,
    }).eq('id', rule.id);
  }
  return result;
}

/** Every rule that is due, across accounts. Called by the scheduler only. */
export async function runDueRules(limit = 20): Promise<number> {
  const { data, error } = await supabaseAdmin.from('prospect_rules').select('*')
    .eq('is_active', true).lte('next_run_at', new Date().toISOString())
    .order('next_run_at', { ascending: true }).limit(limit);
  if (missingTable(error)) return 0;
  if (error) throw new Error(error.message);
  let ran = 0;
  for (const rule of (data || []) as ProspectRule[]) {
    // One account's failure never holds up another's.
    await runRule(rule).catch((e) => console.error(`[ProspectRules] rule ${rule.id} failed:`, e?.message));
    ran++;
  }
  return ran;
}


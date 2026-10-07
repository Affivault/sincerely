/* ═══════════════════════════════════════════════════════════════════════
   Results you can hand to somebody: a read-only link.

   For the manager who asks "what are we getting from this?", or an
   agency's client: a page with the period's results and nothing else -
   no login, no inbox, no contacts, no names of the people emailed. Each
   link is for one fixed period (so "September" stays September), can hide
   the campaign names, counts its views, and can be switched off.

   The token is 24 random bytes; it is the only thing that grants access,
   so it is never logged and a revoked or unknown one answers the same
   "not found". Stored in report_shares (migration 081).
   ═══════════════════════════════════════════════════════════════════════ */

import crypto from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { resultsPeriod, RESULTS_PERIODS, type ResultsPeriodKey, type ResultsShare, type SharedResults } from '@lemlist/shared';
import { resultsService } from './results.service.js';

const TOKEN = /^[A-Za-z0-9_-]{32}$/;

function missingTable(message: string): boolean {
  return /report_shares/.test(message);
}

function toShare(r: any): ResultsShare {
  return {
    id: r.id, token: r.token, title: r.title, period_label: r.period_label,
    from: r.period_from, to: r.period_to, show_campaigns: !!r.show_campaigns,
    views: r.views || 0, last_viewed_at: r.last_viewed_at, created_at: r.created_at, revoked_at: r.revoked_at,
  };
}

export const resultsShareService = {
  async list(userId: string): Promise<ResultsShare[]> {
    const { data, error } = await supabaseAdmin
      .from('report_shares').select('*').eq('user_id', userId).is('revoked_at', null)
      .order('created_at', { ascending: false }).limit(50);
    if (error) {
      if (missingTable(error.message)) return [];
      throw new AppError(error.message, 500);
    }
    return (data || []).map(toShare);
  },

  async create(userId: string, input: { period: string; title?: string; show_campaigns?: boolean }): Promise<ResultsShare> {
    if (!(RESULTS_PERIODS as readonly string[]).includes(input.period)) throw new AppError('Unknown period', 400);
    const { data: s } = await supabaseAdmin.from('user_settings').select('timezone').eq('user_id', userId).maybeSingle();
    // Fixed at the moment of sharing: a link to "last month" must not turn
    // into a different month when it is opened in November.
    const p = resultsPeriod(input.period as ResultsPeriodKey, Date.now(), (s as any)?.timezone);
    const title = String(input.title || '').trim().slice(0, 120) || `Results - ${p.label}`;
    const { data, error } = await supabaseAdmin.from('report_shares').insert({
      user_id: userId,
      token: crypto.randomBytes(24).toString('base64url'),
      title,
      period_label: p.label,
      period_from: p.from,
      // The period's own end: a month shared on the 10th fills in until the
      // month is over, then stays as it was.
      period_to: p.end,
      show_campaigns: input.show_campaigns !== false,
    }).select('*').single();
    if (error) {
      if (missingTable(error.message)) throw new AppError('Run migration 081 to share results.', 409);
      throw new AppError(error.message, 500);
    }
    return toShare(data);
  },

  async revoke(userId: string, id: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError('Link not found', 404);
    const { data, error } = await supabaseAdmin.from('report_shares')
      .update({ revoked_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId).is('revoked_at', null).select('id');
    if (error) throw new AppError(error.message, 500);
    if (!data?.length) throw new AppError('Link not found', 404);
  },

  /** For the public page. Null for anything not live. */
  async open(token: string): Promise<SharedResults | null> {
    if (!TOKEN.test(token)) return null;
    const { data: row, error } = await supabaseAdmin
      .from('report_shares').select('*').eq('token', token).is('revoked_at', null).maybeSingle();
    if (error || !row) return null;
    const r = row as any;
    const report = await resultsService.report(r.user_id, { from: r.period_from, end: r.period_to, label: r.period_label }, { campaigns: !!r.show_campaigns });
    const { data: settings } = await supabaseAdmin.from('user_settings').select('company, first_name, last_name').eq('user_id', r.user_id).maybeSingle();
    const prepared = (settings as any)?.company || [(settings as any)?.first_name, (settings as any)?.last_name].filter(Boolean).join(' ') || null;
    supabaseAdmin.from('report_shares')
      .update({ views: (r.views || 0) + 1, last_viewed_at: new Date().toISOString() })
      .eq('id', r.id).then(() => {}, () => {});
    return { title: r.title, prepared_by: prepared, report };
  },
};

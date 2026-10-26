import {
  engagementScore, storedFactors, ENGAGEMENT_WINDOW_DAYS,
  type EngagementEvent, type EngagementResult,
} from '@lemlist/shared';
import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { chunk, fetchAllPages } from '../utils/batch.js';

/* ═══════════════════════════════════════════════════════════════════════
   Keeping contacts.engagement_score current.

   WHY A JOB IN NODE AND NOT A FUNCTION IN SQL

   The score has to be sortable, so it is a column. It could have been
   computed by a Postgres function, but then the formula would exist twice
   - once in SQL for the column and once in TypeScript for the breakdown the
   contact page shows - and two copies of a weighting drift until the "why"
   no longer adds up to the number beside it. Here there is one copy
   (shared/src/engagement.ts), and this job only gathers the evidence and
   writes the result back through set_engagement_scores (096), which writes
   only rows whose score actually moved.

   It runs every six hours rather than on every open, because the score is
   recency-weighted: it changes with the calendar as well as with events, so
   it has to be swept anyway, and a sweep is cheaper than a trigger on the
   busiest table in the database.
   ═══════════════════════════════════════════════════════════════════════ */

/** Postgres or PostgREST saying 096 has not been run. */
export function engagementMissing(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  const m = error.message || '';
  return error.code === 'PGRST202' || error.code === '42883' || error.code === '42703' || error.code === 'PGRST204'
    || /set_engagement_scores|engagement_score|engagement_factors/.test(m);
}

/** Every human signal for these contacts (or all of an account's) since `since`. */
async function signals(userId: string, since: Date, contactIds?: string[]): Promise<Map<string, EngagementEvent[]>> {
  const out = new Map<string, EngagementEvent[]>();
  const push = (id: string | null | undefined, e: EngagementEvent) => {
    if (!id) return;
    const list = out.get(id);
    if (list) list.push(e); else out.set(id, [e]);
  };
  const iso = since.toISOString();
  const only = contactIds && contactIds.length > 0 ? contactIds : null;

  // Opens and clicks. Only 'opened' and 'clicked': 'machine_open' and
  // 'machine_click' are scanners, and are recorded under their own names
  // precisely so nothing like this counts them (085).
  const activity = await fetchAllPages((from, to) => {
    let q = supabaseAdmin
      .from('campaign_activities')
      .select('contact_id, activity_type, occurred_at, campaigns!inner(user_id)')
      .eq('campaigns.user_id', userId)
      .in('activity_type', ['opened', 'clicked'])
      .gte('occurred_at', iso);
    if (only) q = q.in('contact_id', only);
    return q.order('occurred_at', { ascending: true }).order('id').range(from, to);
  });
  for (const a of activity as any[]) {
    push(a.contact_id, { kind: a.activity_type === 'clicked' ? 'click' : 'open', at: a.occurred_at });
  }

  // Replies, from the inbox: that covers replies to campaigns and replies to
  // anything else alike. An out-of-office is not somebody engaging, and nor
  // is a newsletter that happens to come from a contact's address.
  const replies = await fetchAllPages((from, to) => {
    let q = supabaseAdmin
      .from('inbox_messages')
      .select('contact_id, received_at')
      .eq('user_id', userId)
      .eq('direction', 'inbound')
      .not('contact_id', 'is', null)
      .is('auto_reply_kind', null)
      .or('mail_kind.is.null,mail_kind.eq.person')
      .gte('received_at', iso);
    if (only) q = q.in('contact_id', only);
    return q.order('received_at', { ascending: true }).order('id').range(from, to);
  });
  for (const m of replies as any[]) push(m.contact_id, { kind: 'reply', at: m.received_at });

  // Meetings that happened: started already, not called off, turned up.
  const meetings = await fetchAllPages((from, to) => {
    let q = supabaseAdmin
      .from('crm_events')
      .select('contact_id, starts_at, status')
      .eq('user_id', userId)
      .not('contact_id', 'is', null)
      .in('status', ['confirmed', 'tentative'])
      .gte('starts_at', iso)
      .lte('starts_at', new Date().toISOString());
    if (only) q = q.in('contact_id', only);
    return q.order('starts_at', { ascending: true }).order('id').range(from, to);
  });
  for (const e of meetings as any[]) push(e.contact_id, { kind: 'meeting', at: e.starts_at });

  return out;
}

async function write(userId: string, rows: { id: string; score: number; factors: any }[]): Promise<number> {
  let written = 0;
  for (const slice of chunk(rows, 500)) {
    const { data, error } = await supabaseAdmin.rpc('set_engagement_scores', { p_user_id: userId, p_rows: slice });
    if (error) {
      if (engagementMissing(error)) throw new AppError('Engagement scores need database migration 096_duplicates_views_engagement_noshow.sql.', 503);
      throw new AppError(error.message, 500);
    }
    written += Number(data) || 0;
  }
  return written;
}

export const engagementService = {
  /**
   * Rescore every contact of one account that has done anything in the
   * window, and zero the ones that had a score and have since gone quiet.
   */
  async rescoreAccount(userId: string, now = new Date()): Promise<number> {
    const since = new Date(now.getTime() - ENGAGEMENT_WINDOW_DAYS * 86_400_000);
    const byContact = await signals(userId, since);

    // Anyone scored before and silent since needs writing down to zero, or
    // the decay would stop at their last score.
    const scored = await fetchAllPages((from, to) => supabaseAdmin
      .from('contacts')
      .select('id')
      .eq('user_id', userId)
      .gt('engagement_score', 0)
      .order('id')
      .range(from, to));

    const rows: { id: string; score: number; factors: any }[] = [];
    for (const [id, events] of byContact) {
      const r = engagementScore(events, now);
      rows.push({ id, score: r.score, factors: storedFactors(r) });
    }
    for (const c of scored as any[]) {
      if (!byContact.has(c.id)) rows.push({ id: c.id, score: 0, factors: storedFactors(engagementScore([], now)) });
    }
    return write(userId, rows);
  },

  /** One contact, live, with the breakdown. Also stores the result. */
  async forContact(userId: string, contactId: string): Promise<EngagementResult & { stored: boolean }> {
    const { data: contact, error } = await supabaseAdmin
      .from('contacts').select('id').eq('id', contactId).eq('user_id', userId).maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!contact) throw new AppError('Contact not found', 404);

    const now = new Date();
    const since = new Date(now.getTime() - ENGAGEMENT_WINDOW_DAYS * 86_400_000);
    const events = (await signals(userId, since, [contactId])).get(contactId) || [];
    const result = engagementScore(events, now);

    // Best effort: a database without 096 still gets its breakdown.
    let stored = true;
    try {
      await write(userId, [{ id: contactId, score: result.score, factors: storedFactors(result) }]);
    } catch {
      stored = false;
    }
    return { ...result, stored };
  },
};

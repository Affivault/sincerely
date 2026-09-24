/* ═══════════════════════════════════════════════════════════════════════
   What changed while you were away.

   Somebody back from a day off opens the app to fifty unread things and no
   sense of which matter. This is the answer to "what happened?" in one
   line of counts, each of which opens the thing it counts.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import type { AwaySummary } from '@lemlist/shared';

/** Anything older than this is not "while you were away", it is history. */
const MAX_WINDOW_MS = 30 * 86_400_000;

export async function awaySummary(userId: string, sinceRaw: unknown): Promise<AwaySummary> {
  const parsed = Date.parse(String(sinceRaw || ''));
  if (!Number.isFinite(parsed)) throw new AppError('since must be an ISO timestamp', 400);
  const since = new Date(Math.max(parsed, Date.now() - MAX_WINDOW_MS)).toISOString();

  const head = { count: 'exact' as const, head: true };
  const [replies, positive, meetings, created, won, bounces, completed] = await Promise.all([
    supabaseAdmin.from('inbox_messages').select('id', head).eq('user_id', userId)
      .eq('direction', 'inbound').is('auto_reply_kind', null).gte('received_at', since),
    supabaseAdmin.from('inbox_messages').select('id', head).eq('user_id', userId)
      .in('sara_intent', ['interested', 'meeting']).gte('received_at', since),
    supabaseAdmin.from('crm_events').select('id', head).eq('user_id', userId).gte('created_at', since)
      .or('status.is.null,status.neq.cancelled'),
    supabaseAdmin.from('deals').select('id', head).eq('user_id', userId).gte('created_at', since),
    supabaseAdmin.from('deals').select('value').eq('user_id', userId).eq('stage', 'won').gte('closed_at', since),
    supabaseAdmin.from('campaign_activities').select('id, campaigns!inner(user_id)', head)
      .eq('campaigns.user_id', userId).eq('activity_type', 'bounced').gte('occurred_at', since),
    supabaseAdmin.from('campaigns').select('id', head).eq('user_id', userId)
      .eq('status', 'completed').gte('completed_at', since),
  ]);
  for (const r of [replies, positive, meetings, created, won, bounces, completed]) {
    if (r.error) throw new AppError(r.error.message, 500);
  }
  return {
    since,
    replies: replies.count || 0,
    positive_replies: positive.count || 0,
    meetings_booked: meetings.count || 0,
    deals_created: created.count || 0,
    deals_won: (won.data || []).length,
    won_value: (won.data || []).reduce((n: number, d: any) => n + (Number(d.value) || 0), 0),
    bounces: bounces.count || 0,
    campaigns_completed: completed.count || 0,
  };
}

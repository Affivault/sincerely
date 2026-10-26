import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { SNOOZE_MAX_DAYS, isNudgeDays } from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Snooze, and "nudge me if no reply".

   Both are ways of saying "not now, but do not let me forget". A snoozed
   conversation leaves the inbox and every count until its time comes, then
   comes back unread at the top. A nudge sits on a message we sent: if
   nobody has answered by the day chosen, the conversation comes back with
   "No reply yet" on it - and if they do answer, the nudge quietly goes.

   The columns: snoozed_until is migration 071's (the reply queue's
   "parked"), and the inbox now honours it too, so a reply parked from the
   queue and a conversation snoozed here are the same thing seen from two
   places. nudge_at, nudge_fired_at and resurfaced_at are migration 092's.
   Until 092 is run snoozing still works and nudges are refused with a
   message saying why; nothing that worked before stops working.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Which columns exist ─────────────────────────────────────────────── */

/*
 * Probed, not assumed, and remembered once true. A false answer is asked
 * again after a minute, so running the migration takes effect without a
 * restart - the same shape as mailKindReady.
 */
const probes = new Map<string, { ok: boolean; at: number }>();

async function columnsReady(key: string, columns: string): Promise<boolean> {
  const seen = probes.get(key);
  if (seen?.ok) return true;
  if (seen && Date.now() - seen.at < 60_000) return false;
  const { error } = await supabaseAdmin
    .from('inbox_messages')
    .select(columns, { head: true, count: 'exact' })
    .limit(1);
  probes.set(key, { ok: !error, at: Date.now() });
  return !error;
}

/** snoozed_until (071). Without it the inbox simply does not hide anything. */
export const snoozeReady = () => columnsReady('snooze', 'snoozed_until');
/** nudge_at, nudge_fired_at, resurfaced_at (092). */
export const remindersReady = () => columnsReady('reminders', 'nudge_at, nudge_fired_at, resurfaced_at, resurfaced_reason');
/** assigned_to (071). */
export const assignReady = () => columnsReady('assign', 'assigned_to, assigned_at, assigned_by');

/**
 * The one definition of "not snoozed right now", as a PostgREST or-filter.
 *
 * Every inbox read goes through this - the list, the unread badge, each
 * sidebar count - so they cannot disagree. They did once over is_archived
 * (one said `= false`, the other `null or false`) and the badge read lower
 * than the unread rows plainly on screen; this is the same trap with a new
 * column. A past snoozed_until counts as awake even before the sweep clears
 * it, so a conversation is never missing for the minute between ticks.
 */
export function notSnoozedFilter(now: Date = new Date()): string {
  return `snoozed_until.is.null,snoozed_until.lte.${now.toISOString()}`;
}

/* ── The conversation a message belongs to ───────────────────────────── */

/**
 * The other party's address, as the PostgREST filter that matches every
 * message with them in either direction.
 *
 * Case-insensitive equality: ilike with its wildcards escaped. The quotes
 * keep a comma or parenthesis in an address from splicing extra predicates
 * into the or(); a quote inside it is dropped because PostgREST does not
 * read a doubled one as escaped.
 */
export function addressFilter(email: string): string {
  const pattern = email.replace(/([%_\\])/g, '\\$1');
  const q = `"${pattern.replace(/"/g, '')}"`;
  return `from_email.ilike.${q},to_email.ilike.${q}`;
}

/**
 * Our mail to one address, by the same case-insensitive equality. Written
 * as an or-filter rather than .ilike('to_email', ...) because it is an
 * exact match, not a substring search: no leading wildcard, so it neither
 * needs nor could use the trigram index search-index-check asks of a
 * searched column.
 */
function sentToFilter(email: string): string {
  const pattern = email.trim().replace(/([%_\\])/g, '\\$1');
  return `to_email.ilike."${pattern.replace(/"/g, '')}"`;
}

async function counterpartyOf(userId: string, messageId: string): Promise<{ email: string | null; row: any }> {
  const { data: msg, error } = await supabaseAdmin
    .from('inbox_messages')
    .select('id, direction, from_email, to_email, contacts(email)')
    .eq('id', messageId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new AppError(error.message, 500);
  if (!msg) throw new AppError('Message not found', 404);
  const email = (msg as any).contacts?.email
    || (msg.direction === 'outbound' ? msg.to_email : msg.from_email)
    || null;
  return { email, row: msg };
}

function isMissingFunction(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false;
  return err.code === 'PGRST202' || err.code === '42883' || /could not find the function|does not exist/i.test(err.message || '');
}

let warnedNoNudgeFn = false;

export const inboxRemindersService = {
  /**
   * Snooze a whole conversation until a time, or wake it now (until = null).
   *
   * The whole conversation, because that is what the inbox shows as one
   * row: snoozing only the newest message would leave the one before it
   * standing in for the conversation, as if nothing had happened.
   */
  async snoozeThread(userId: string, messageId: string, until: string | null) {
    if (!(await snoozeReady())) {
      throw new AppError('Snoozing needs database migration 071. Run it in the Supabase SQL editor, then try again.', 503);
    }
    let at: string | null = null;
    if (until) {
      const t = Date.parse(until);
      if (!Number.isFinite(t)) throw new AppError('That is not a date', 400);
      if (t <= Date.now()) throw new AppError('Pick a time in the future', 400);
      if (t > Date.now() + SNOOZE_MAX_DAYS * 86_400_000) {
        throw new AppError('Snooze for up to a year. Further than that, archive it.', 400);
      }
      at = new Date(t).toISOString();
    }

    const { email } = await counterpartyOf(userId, messageId);
    let q = supabaseAdmin.from('inbox_messages').update(
      at
        ? { snoozed_until: at }
        // Waking by hand: nothing to resurface, it is in front of them.
        : { snoozed_until: null, snooze_note: null },
    ).eq('user_id', userId);
    q = email ? q.or(addressFilter(email)) : q.eq('id', messageId);
    if (!at) q = q.not('snoozed_until', 'is', null);
    const { data, error } = await q.select('id');
    if (error) throw new AppError(error.message, 500);

    // A snooze replaces whatever brought it back last time.
    if (at && (await remindersReady())) {
      let clear = supabaseAdmin.from('inbox_messages')
        .update({ resurfaced_at: null, resurfaced_reason: null })
        .eq('user_id', userId)
        .not('resurfaced_at', 'is', null);
      clear = email ? clear.or(addressFilter(email)) : clear.eq('id', messageId);
      await clear;
    }
    return { snoozed_until: at, messages: (data || []).length };
  },

  /**
   * "Remind me if no reply in N days", on a message we sent. null clears it.
   *
   * Only on outbound mail: a nudge asks whether THEY answered, and on a
   * message they sent that question has no meaning.
   */
  async setNudge(userId: string, messageId: string, days: number | null) {
    if (!(await remindersReady())) {
      throw new AppError('Reminders need database migration 092. Run it in the Supabase SQL editor, then try again.', 503);
    }
    if (days !== null && !isNudgeDays(days)) throw new AppError('Choose 1, 2, 3, 5, 7 or 14 days', 400);

    const { data: msg } = await supabaseAdmin
      .from('inbox_messages')
      .select('id, direction')
      .eq('id', messageId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!msg) throw new AppError('Message not found', 404);
    if (msg.direction !== 'outbound') throw new AppError('Reminders go on a message you sent', 400);

    const nudgeAt = days === null ? null : nudgeAtFor(days);
    const { error } = await supabaseAdmin
      .from('inbox_messages')
      .update({ nudge_at: nudgeAt, nudge_fired_at: null })
      .eq('id', messageId)
      .eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
    return { nudge_at: nudgeAt };
  },

  /**
   * We just wrote to them again: any earlier "no reply yet" is answered by
   * our own follow-up, and an older reminder would fire about a message
   * that is no longer the last word.
   */
  async supersedeNudges(userId: string, toEmail: string, exceptId?: string) {
    if (!toEmail || !(await remindersReady())) return;
    let q = supabaseAdmin.from('inbox_messages')
      .update({ nudge_at: null, nudge_fired_at: null })
      .eq('user_id', userId)
      .eq('direction', 'outbound')
      .or(sentToFilter(toEmail))
      .or('nudge_at.not.is.null,nudge_fired_at.not.is.null');
    if (exceptId) q = q.neq('id', exceptId);
    const { error } = await q;
    if (error) console.warn('[Reminders] could not supersede earlier nudges:', error.message);
  },

  /**
   * Somebody wrote in. Their conversation's nudges are answered, and if it
   * was snoozed it comes back now - a reply is the one thing that should
   * never wait for a snooze to end.
   *
   * Called from the sync for a person's message (not an auto-reply), and
   * best-effort: the message is already saved, and a failure here leaves
   * the minute sweep to do the same work.
   */
  async onInbound(userId: string, fromEmail: string | null | undefined) {
    const from = String(fromEmail || '').trim();
    if (!from) return;

    if (await remindersReady()) {
      await supabaseAdmin.from('inbox_messages')
        .update({ nudge_at: null, nudge_fired_at: null })
        .eq('user_id', userId)
        .eq('direction', 'outbound')
        .or(sentToFilter(from))
        .or('nudge_at.not.is.null,nudge_fired_at.not.is.null');
    }

    if (await snoozeReady()) {
      const wake: Record<string, unknown> = { snoozed_until: null, snooze_note: null };
      if (await remindersReady()) Object.assign(wake, { resurfaced_at: new Date().toISOString(), resurfaced_reason: 'snooze' });
      await supabaseAdmin.from('inbox_messages')
        .update(wake)
        .eq('user_id', userId)
        .gt('snoozed_until', new Date().toISOString())
        .or(addressFilter(from));
    }
  },

  /**
   * Opening a conversation that came back puts it back in its place: it
   * was held at the top so it would be seen, and it has been. The "No
   * reply yet" marker stays - that is still true until they answer.
   */
  async settleResurfaced(userId: string, email: string | null, messageId: string) {
    if (!(await remindersReady())) return;
    let q = supabaseAdmin.from('inbox_messages')
      .update({ resurfaced_at: null, resurfaced_reason: null })
      .eq('user_id', userId)
      .not('resurfaced_at', 'is', null);
    q = email ? q.or(addressFilter(email)) : q.eq('id', messageId);
    const { error } = await q;
    if (error) console.warn('[Reminders] could not settle a resurfaced conversation:', error.message);
  },

  /**
   * One tick of the scheduler: wake what is due, then check due nudges.
   *
   * Cross-tenant by design, which is why it lives behind a scheduler and
   * never a route. Each half is one database statement (migration 092), so
   * two servers ticking at once cannot both fire the same nudge.
   */
  async sweep(): Promise<{ woken: number; fired: number; answered: number }> {
    let woken = 0;
    let fired = 0;
    let answered = 0;

    const wake = await supabaseAdmin.rpc('inbox_wake_snoozed', { p_limit: 500 });
    if (!wake.error) {
      woken = (wake.data || []).length;
    } else if (isMissingFunction(wake.error)) {
      // Before 092: wake them by hand. No resurfaced_at to set, so they come
      // back unread at their own date rather than at the top.
      if (await snoozeReady()) {
        const { data, error } = await supabaseAdmin.from('inbox_messages')
          .update({ snoozed_until: null, snooze_note: null, is_read: false })
          .lte('snoozed_until', new Date().toISOString())
          .select('id');
        if (error) throw new Error(`waking snoozed mail: ${error.message}`);
        woken = (data || []).length;
      }
    } else {
      throw new Error(`waking snoozed mail: ${wake.error.message}`);
    }

    const nudge = await supabaseAdmin.rpc('inbox_fire_nudges', { p_limit: 500 });
    if (!nudge.error) {
      for (const r of (nudge.data || []) as Array<{ outcome: string }>) {
        if (r.outcome === 'fired') fired++;
        else answered++;
      }
    } else if (isMissingFunction(nudge.error)) {
      // Nothing can have a nudge without the column 092 adds, so there is
      // nothing missed here - say it once, not every minute.
      if (!warnedNoNudgeFn) {
        warnedNoNudgeFn = true;
        console.warn('[Reminders] migration 092 not run yet - nudges are off until it is');
      }
    } else {
      throw new Error(`checking nudges: ${nudge.error.message}`);
    }

    return { woken, fired, answered };
  },
};

/** When a nudge of N days, set now, comes due. */
export function nudgeAtFor(days: number, from: Date = new Date()): string {
  return new Date(from.getTime() + days * 86_400_000).toISOString();
}

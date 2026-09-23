import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { selectInChunks } from '../utils/batch.js';
import {
  replyState, replyPriority, queueCounts, needsHuman, isOpen,
  type ReplyFacts,
} from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Which reply to answer first, and which one is late.

   Forty replies land, three matter, and the three get lost. The app could
   already classify a reply and triage it into a disposition, but nothing
   said how long somebody had been waiting or what to do first.

   All the deciding is in shared/reply-queue, against plain values. This
   is the part that has to touch the database: fetch the working set,
   attach what is at stake, sort, and record the two things a person does
   to a reply - claim it, or park it with a date.

   ON ASSIGNMENT, AND WHAT IS DELIBERATELY NOT BUILT HERE

   Every service in this app scopes by user_id; team_members maps an org
   to users but nothing reads it for data access. So a teammate cannot
   currently see another user's inbox at all, and "assign to Sarah" would
   hand a reply to somebody with no way to open it - a promise the system
   cannot keep.

   The column takes any user id, so nothing here needs changing when
   org-scoped access lands. Until then the only assignment offered is
   claiming a reply yourself, which is honest and still useful: coming
   back after lunch and seeing what you had already picked up is most of
   the value for one person.
   ═══════════════════════════════════════════════════════════════════════ */

/** The working set. Inbound, unanswered, not older than this. */
const QUEUE_WINDOW_DAYS = 45;
const MAX_ROWS = 400;

const QUEUE_COLUMNS = `
  id, user_id, contact_id, campaign_id, from_email, to_email, subject,
  body_text, received_at, is_read, auto_reply_kind, sara_intent,
  sara_confidence, triage_decision, assigned_to, assigned_at,
  first_response_at, first_response_by, snoozed_until, snooze_note
`;

type QueueRow = ReplyFacts & {
  id: string;
  contact_id: string | null;
  from_email: string;
  subject: string | null;
  body_text: string | null;
};

/**
 * What is on the table behind these replies.
 *
 * A reply attached to an open deal is a different conversation from one
 * that is not, and the ranking says so. Looked up in one query for the
 * whole page rather than per row - forty replies would otherwise be forty
 * round trips to move a few of them up a list.
 */
async function dealValueByContact(
  userId: string, contactIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (contactIds.length === 0) return out;

  // Sliced: up to four hundred ids in one `in` list is a URL the gateway
  // refuses, and a refused lookup here quietly ranked every reply as if
  // nothing were at stake.
  const data = await selectInChunks(contactIds.slice(0, MAX_ROWS), (slice) =>
    supabaseAdmin
      .from('deals')
      .select('contact_id, value, stage')
      .eq('user_id', userId)
      .in('contact_id', slice)).catch(() => [] as any[]);

  for (const deal of data) {
    /*
     * Open deals only. A closed-lost deal is not what is at stake now,
     * and a closed-won one is already earned.
     *
     * Through the shared isOpen rather than a comparison here - the
     * stages are a list that has grown before, and a second opinion
     * about which of them are finished is a second opinion that drifts.
     */
    if (!isOpen(deal.stage as any)) continue;
    const id = deal.contact_id as string | null;
    if (!id) continue;
    out.set(id, (out.get(id) || 0) + (Number(deal.value) || 0));
  }
  return out;
}

export const replyQueueService = {
  /**
   * The replies with a person waiting, hardest-first.
   *
   * Ordering comes from shared/reply-queue rather than from SQL because
   * it is a judgement - intent, then what is at stake, then lateness -
   * and a judgement in an ORDER BY is a judgement nobody can test.
   */
  async queue(userId: string, opts: { filter?: 'all' | 'overdue' | 'mine' | 'unassigned' | 'parked' } = {}) {
    const since = new Date(Date.now() - QUEUE_WINDOW_DAYS * 86_400_000).toISOString();

    const { data, error } = await supabaseAdmin
      .from('inbox_messages')
      .select(QUEUE_COLUMNS)
      .eq('user_id', userId)
      /*
       * Outbound mail is our own; it is never waiting on us. Older rows
       * predate the column, so `is null` covers them rather than
       * excluding every reply received before this shipped.
       */
      .or('direction.is.null,direction.eq.inbound')
      .is('first_response_at', null)
      .is('auto_reply_kind', null)
      .gte('received_at', since)
      .order('received_at', { ascending: false })
      .limit(MAX_ROWS);

    if (error) throw new AppError(error.message, 500);

    const rows = (data || []) as unknown as QueueRow[];
    const contactIds = [...new Set(rows.map((r) => r.contact_id).filter(Boolean) as string[])];
    const values = await dealValueByContact(userId, contactIds);

    const now = Date.now();
    const enriched = rows.map((row) => {
      const facts: ReplyFacts = {
        ...row,
        deal_value: row.contact_id ? values.get(row.contact_id) ?? null : null,
      };
      return {
        ...row,
        deal_value: facts.deal_value,
        state: replyState(facts, now),
        priority: replyPriority(facts, now),
      };
    });

    const live = enriched.filter((r) => r.state.urgency !== 'done');
    const counts = queueCounts(
      live.map((r) => ({ ...r, deal_value: r.deal_value })),
      { now, userId },
    );

    const filter = opts.filter || 'all';
    const filtered = live.filter((r) => {
      switch (filter) {
        case 'overdue': return r.state.urgency === 'overdue';
        case 'mine': return r.assigned_to === userId && r.state.urgency !== 'parked';
        case 'unassigned': return !r.assigned_to && r.state.urgency !== 'parked';
        case 'parked': return r.state.urgency === 'parked';
        // Parked work is handled, so it is out of the default view -
        // that is the whole point of being able to park something.
        default: return r.state.urgency !== 'parked';
      }
    });

    filtered.sort((a, b) => b.priority - a.priority);
    return { counts, items: filtered };
  },

  async counts(userId: string) {
    const { counts } = await this.queue(userId);
    return counts;
  },

  /**
   * Claim a reply, or hand it back.
   *
   * `assignee` is a user id so this needs no change once org-scoped
   * access exists; today the route only ever passes the caller's own id,
   * because anybody else could not open the message.
   */
  async assign(userId: string, messageId: string, assignee: string | null) {
    const { data, error } = await supabaseAdmin
      .from('inbox_messages')
      .update({
        assigned_to: assignee,
        assigned_at: assignee ? new Date().toISOString() : null,
        assigned_by: assignee ? userId : null,
      })
      .eq('id', messageId)
      .eq('user_id', userId)
      .select('id, assigned_to, assigned_at')
      .maybeSingle();

    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Message not found', 404);
    return data;
  },

  /**
   * Park a reply until a date.
   *
   * Without this the only way to clear "ask me in March" from the queue
   * is to pretend it is answered - and an overdue count that includes
   * handled work is a number people stop reading, which costs more than
   * the one reply it hid.
   *
   * Parking does NOT reset the clock. The wait is measured from when the
   * reply arrived, because that is when the person started waiting;
   * parking is a promise to come back, not a fresh start.
   */
  async snooze(userId: string, messageId: string, until: string | null, note?: string) {
    if (until) {
      const at = Date.parse(until);
      if (!Number.isFinite(at)) throw new AppError('That is not a date', 400);
      if (at <= Date.now()) {
        throw new AppError('Pick a time in the future - parking something until the past does nothing.', 400);
      }
    }

    const { data, error } = await supabaseAdmin
      .from('inbox_messages')
      .update({
        snoozed_until: until,
        snooze_note: until ? (note || null) : null,
      })
      .eq('id', messageId)
      .eq('user_id', userId)
      .select('id, snoozed_until, snooze_note')
      .maybeSingle();

    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Message not found', 404);
    return data;
  },

  /**
   * Stop the clock, for the whole conversation.
   *
   * Answering any message in a thread answers the person, so every
   * unanswered inbound message in it is marked at once. Marking only the
   * one that was open would leave its siblings sitting in the queue as
   * overdue replies to a conversation that has been handled.
   *
   * Deliberately separate from triage. Deciding a reply is "interested"
   * is a note to yourself; it is not answering the person who wrote in,
   * and conflating the two is how an SLA silently becomes a measure of
   * how fast somebody clicks a label.
   */
  async markResponded(userId: string, messageId: string): Promise<void> {
    const { data: msg } = await supabaseAdmin
      .from('inbox_messages')
      .select('id, thread_id, message_id')
      .eq('id', messageId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!msg) return;

    const now = new Date().toISOString();
    const stamp = { first_response_at: now, first_response_by: userId };

    const thread = msg.thread_id || msg.message_id;
    if (thread) {
      await supabaseAdmin
        .from('inbox_messages')
        .update(stamp)
        .eq('user_id', userId)
        .eq('thread_id', thread)
        .is('first_response_at', null)
        // Our own outbound messages were never waiting on us.
        .or('direction.is.null,direction.eq.inbound');
    }

    /*
     * And the message itself, whatever its thread turned out to be. A
     * mailbox that does not set References leaves messages with no
     * thread_id at all, and those are exactly the one-off replies most
     * worth not losing.
     */
    await supabaseAdmin
      .from('inbox_messages')
      .update(stamp)
      .eq('id', messageId)
      .eq('user_id', userId)
      .is('first_response_at', null);
  },

  /** Whether one message is still waiting on a human. */
  async isWaiting(userId: string, messageId: string): Promise<boolean> {
    const { data } = await supabaseAdmin
      .from('inbox_messages')
      .select('received_at, sara_intent, auto_reply_kind, triage_decision, first_response_at, snoozed_until')
      .eq('id', messageId)
      .eq('user_id', userId)
      .maybeSingle();
    return data ? needsHuman(data as ReplyFacts) : false;
  },
};

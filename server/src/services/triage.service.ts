import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { leadsService } from './leads.service.js';
import { crmService } from './crm.service.js';
import { suppressionService } from './suppression.service.js';
import { promoteToContact } from './lifecycle.service.js';
import {
  BULK_TRIAGE_LIMIT,
  DEFAULT_SNOOZE_DAYS,
  leadTitleFrom,
  NOT_INTERESTED_REASONS,
  type BulkTriageOutcome,
  type BulkTriageResult,
  type TriageDecision,
  type TriageInput,
  type TriageResult,
} from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Acting on a reply.

   One endpoint rather than three calls from the client, for two reasons.

   The obvious one is that "interested" is not a single write: it makes a
   lead, promotes a lifecycle, and carries the campaign across so the deal
   that follows is attributed to the outreach that earned it. Three round
   trips would half-succeed in ways nobody could see.

   The less obvious one is that the decision is the unit of meaning. What a
   reply IS - worth pursuing, worth pursuing later, not worth pursuing - is
   a product concept, and spreading it across three unrelated endpoints
   leaves it defined nowhere.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * The counterparty on a message, whichever way it was going.
 *
 * The linked contact's address wins where there is one: from_email is
 * whatever the mail server said, which for a forwarded or aliased reply is
 * not the address the campaign was sent to. Mirrors how inbox.service
 * resolves the same thing, rather than inventing a second rule.
 */
function counterparty(message: any): string | null {
  const linked = message.contacts?.email;
  const raw = linked || (message.direction === 'outbound' ? message.to_email : message.from_email);
  const trimmed = String(raw || '').trim().toLowerCase();
  return trimmed || null;
}

export const triageService = {
  /**
   * Record what a reply is, and do the work that follows from it.
   *
   * @param messageId The stored email being triaged.
   */
  async triage(userId: string, messageId: string, input: TriageInput): Promise<TriageResult> {
    const decision = input.decision as TriageDecision;

    /*
     * inbox_messages, and only columns that are actually on it.
     *
     * There is no `emails` table and no `contact_email` column - both were
     * assumptions, and both would have failed on the first real request. The
     * contact's address comes from the join, which is where it lives.
     */
    const { data: message } = await supabaseAdmin
      .from('inbox_messages')
      .select('id, user_id, subject, from_email, to_email, direction, contact_id, campaign_id, triage_decision, triage_ref, contacts(email)')
      .eq('id', messageId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!message) throw new AppError('Message not found', 404);

    const email = counterparty(message);

    /*
     * Already decided? Say so rather than doing it twice.
     *
     * Two people on one inbox, or a double-press on a slow connection, would
     * otherwise make two leads or suppress somebody who had been marked
     * interested a second earlier.
     */
    if (message.triage_decision) {
      return {
        decision: message.triage_decision,
        message: `Already triaged as "${message.triage_decision.replace('_', ' ')}"`,
      };
    }

    let result: TriageResult;
    switch (decision) {
      case 'interested':
        result = await this.markInterested(userId, message, email, input);
        break;
      case 'later':
        result = await this.markLater(userId, message, email, input);
        break;
      case 'not_interested':
        result = await this.markNotInterested(userId, message, email, input);
        break;
      default:
        throw new AppError(`Unknown decision "${decision}"`, 400);
    }

    /*
     * Remember it, or none of this is a feature.
     *
     * Without this the decision lives in a component's state: reload and the
     * thread is back at the start offering to be decided again, and there is
     * no way to ask "what have I not dealt with yet" - which is the only
     * question an inbox queue exists to answer.
     *
     * The reference is what makes undo exact rather than a guess from
     * timestamps about which lead to remove.
     */
    await supabaseAdmin
      .from('inbox_messages')
      .update({
        triage_decision: decision,
        triaged_at: new Date().toISOString(),
        triaged_by: userId,
        triage_ref: result.lead_id || result.task_id || null,
      })
      .eq('id', message.id)
      .eq('user_id', userId);

    return result;
  },

  /**
   * The same decision about many replies at once.
   *
   * The point of a queue. Forty replies arrive overnight, most of them the
   * same kind of answer, and a tool that makes you open each one to say so is
   * a tool people stop opening.
   *
   * Deliberately sequential and deliberately tolerant. Sequential because
   * "interested" is several writes each and firing a hundred of those
   * concurrently is how you find out your database has a connection limit.
   * Tolerant because one message that cannot be triaged - no contact linked,
   * no address to suppress - must not take the other thirty-nine down with
   * it; it is reported by name instead.
   */
  async triageMany(userId: string, messageIds: string[], input: TriageInput): Promise<BulkTriageResult> {
    const decision = input.decision as TriageDecision;
    if (!['interested', 'later', 'not_interested'].includes(decision)) {
      throw new AppError(`Unknown decision "${decision}"`, 400);
    }

    /*
     * De-duplicated, because a selection built from a grouped list can name
     * the same message twice and the second pass would report it as "already
     * triaged" - which is true, and confusing, since it was this run that
     * triaged it.
     */
    const ids = [...new Set((messageIds || []).filter((id) => typeof id === 'string' && id))];
    if (ids.length === 0) throw new AppError('No replies were selected.', 400);
    if (ids.length > BULK_TRIAGE_LIMIT) {
      throw new AppError(`That is more than ${BULK_TRIAGE_LIMIT} replies at once. Do it in smaller batches.`, 400);
    }

    const outcomes: BulkTriageOutcome[] = [];
    for (const messageId of ids) {
      try {
        const result = await this.triage(userId, messageId, input);
        outcomes.push({ message_id: messageId, ok: true, result });
      } catch (err: any) {
        outcomes.push({
          message_id: messageId,
          ok: false,
          error: err?.message || 'Could not record that decision',
        });
      }
    }

    const succeeded = outcomes.filter((o) => o.ok);
    const failed = outcomes.length - succeeded.length;
    const label = decision.replace('_', ' ');

    return {
      decision,
      succeeded: succeeded.length,
      failed,
      outcomes,
      undoable: succeeded.map((o) => o.message_id),
      message: failed === 0
        ? `${succeeded.length} ${succeeded.length === 1 ? 'reply' : 'replies'} marked ${label}`
        : `${succeeded.length} marked ${label}, ${failed} could not be`,
    };
  },

  /**
   * Take a whole run back.
   *
   * A misfire on a bulk action is worse than a misfire on one, by exactly the
   * size of the selection - thirty people suppressed by a keystroke meant for
   * something else. Same tolerance as the forward direction: whatever can be
   * undone is, and what cannot is named.
   */
  async undoMany(userId: string, messageIds: string[]): Promise<{ undone: number; failed: number; message: string }> {
    const ids = [...new Set((messageIds || []).filter((id) => typeof id === 'string' && id))];
    if (ids.length === 0) throw new AppError('Nothing to undo.', 400);
    if (ids.length > BULK_TRIAGE_LIMIT) {
      throw new AppError(`That is more than ${BULK_TRIAGE_LIMIT} replies at once.`, 400);
    }

    let undone = 0;
    let failed = 0;
    for (const messageId of ids) {
      try {
        await this.undo(userId, messageId);
        undone++;
      } catch {
        failed++;
      }
    }

    return {
      undone,
      failed,
      message: failed === 0
        ? `${undone} ${undone === 1 ? 'decision' : 'decisions'} undone`
        : `${undone} undone, ${failed} could not be`,
    };
  },

  /**
   * Take it back.
   *
   * Every decision here is one keystroke and two of them are consequential -
   * a lead somebody now has to deal with, or a person no campaign will ever
   * reach again. A misfire on a list of forty replies is not a hypothetical,
   * and "restore it by hand from three different pages" is not an answer.
   *
   * The reference recorded at triage time is what makes this exact: the lead
   * that was created is deleted, not the newest lead, and the suppression
   * removed is the address on this thread rather than whatever was added
   * most recently.
   *
   * Best-effort on the pieces, strict on the message. If a lead has already
   * been converted to a deal the delete will fail, and that is fine - the
   * thread still returns to the queue and the person is told what could not
   * be undone, which beats refusing the whole thing.
   */
  async undo(userId: string, messageId: string): Promise<{ message: string }> {
    const { data: message } = await supabaseAdmin
      .from('inbox_messages')
      .select('id, user_id, direction, from_email, to_email, triage_decision, triage_ref, contacts(email)')
      .eq('id', messageId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!message) throw new AppError('Message not found', 404);
    if (!(message as any).triage_decision) {
      throw new AppError('That reply has not been triaged.', 400);
    }

    const decision = (message as any).triage_decision as TriageDecision;
    const ref = (message as any).triage_ref as string | null;
    const notes: string[] = [];

    if (decision === 'interested' && ref) {
      const { error } = await supabaseAdmin
        .from('leads').delete().eq('id', ref).eq('user_id', userId);
      notes.push(error ? 'the lead could not be removed (it may already be a deal)' : 'the lead was removed');
    }

    if (decision === 'later' && ref) {
      const { error } = await supabaseAdmin
        .from('crm_tasks').delete().eq('id', ref).eq('user_id', userId);
      notes.push(error ? 'the follow-up could not be removed' : 'the follow-up was removed');
    }

    if (decision === 'not_interested') {
      const email = counterparty(message);
      if (email) {
        await suppressionService.remove(userId, email).catch(() => {
          notes.push('the suppression could not be lifted');
        });
        if (notes.length === 0) notes.push('they can be emailed again');
      }
    }

    await supabaseAdmin
      .from('inbox_messages')
      .update({ triage_decision: null, triaged_at: null, triaged_by: null, triage_ref: null })
      .eq('id', messageId)
      .eq('user_id', userId);

    return {
      message: notes.length ? `Undone — ${notes.join(', ')}` : 'Undone',
    };
  },

  /**
   * Worth pursuing: make it a lead, carrying everything already known.
   *
   * The campaign travels with it. A lead made from a reply to a sequence is
   * the clearest evidence that sequence produced whatever it becomes, and
   * losing the link here would mean the deal later has to guess.
   */
  async markInterested(userId: string, message: any, email: string | null, input: TriageInput): Promise<TriageResult> {
    if (!message.contact_id) {
      throw new AppError(
        'This message is not linked to a contact yet, so there is nobody to make a lead about.',
        400,
      );
    }

    /*
     * One open lead per person is a database rule (migration 054), so an
     * existing one is reported rather than duplicated. Pressing the key
     * twice on a thread you already triaged should tell you so, not fail
     * with a constraint violation.
     */
    const existing = await leadsService.list(userId, { status: 'open', contactId: message.contact_id });
    if (existing.length > 0) {
      return {
        decision: 'interested',
        lead_id: existing[0].id,
        message: `Already a lead: ${existing[0].title}`,
      };
    }

    const { data: contact } = await supabaseAdmin
      .from('contacts')
      .select('first_name, last_name, company')
      .eq('id', message.contact_id)
      .eq('user_id', userId)
      .maybeSingle();

    const title = input.title?.trim() || leadTitleFrom({
      company: contact?.company,
      contactName: [contact?.first_name, contact?.last_name].filter(Boolean).join(' '),
      email,
      subject: message.subject,
    });

    const lead = await leadsService.create(userId, {
      contact_id: message.contact_id,
      title,
      campaign_id: message.campaign_id || null,
      source: message.campaign_id ? 'Campaign reply' : 'Inbox reply',
      note: message.subject ? `From: ${message.subject}` : null,
    });

    // Somebody you have decided to pursue is not a stranger. Bookkeeping, so
    // it must never take the triage down with it.
    promoteToContact(userId, [message.contact_id], 'lead').catch(() => {});

    return {
      decision: 'interested',
      lead_id: lead.id,
      message: `Lead created: ${lead.title}`,
    };
  },

  /**
   * Worth pursuing later: a dated follow-up, and nothing else changes.
   *
   * Deliberately does not suppress, archive or move anybody. "Not now" is
   * the answer that most often turns into revenue, and burying the person
   * to clear the inbox is how that gets lost.
   */
  async markLater(userId: string, message: any, email: string | null, input: TriageInput): Promise<TriageResult> {
    const days = Number.isFinite(input.snooze_days) && (input.snooze_days as number) > 0
      ? Math.floor(input.snooze_days as number)
      : DEFAULT_SNOOZE_DAYS;

    const due = new Date();
    due.setDate(due.getDate() + days);

    const who = message.contact_id ? '' : ` (${email || 'unknown address'})`;
    const task = await crmService.createTask(userId, {
      title: `Follow up${who}: ${message.subject || 'their reply'}`,
      contact_id: message.contact_id || null,
      due_date: due.toISOString().slice(0, 10),
      type: 'follow_up',
      priority: 'normal',
    });

    return {
      decision: 'later',
      task_id: (task as any)?.id,
      due_at: due.toISOString(),
      message: `Follow-up set for ${due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
    };
  },

  /**
   * Not worth pursuing: suppress, and keep the reason.
   *
   * Suppression rather than a flag on the thread, because the promise has to
   * hold across every campaign and every list - the whole point of a "no" is
   * that it is answered once. The reason is kept because it is the most
   * information-dense thing a prospect ever tells you.
   */
  async markNotInterested(userId: string, message: any, email: string | null, input: TriageInput): Promise<TriageResult> {
    if (!email) {
      throw new AppError('That message has no address to suppress.', 400);
    }

    const known = NOT_INTERESTED_REASONS.some((r) => r.id === input.reason);
    const note = known ? input.reason : 'other';

    await suppressionService.add(userId, email, 'manual', `Not interested: ${note}`);

    return {
      decision: 'not_interested',
      suppressed_email: email,
      message: `${email} will not be emailed again`,
    };
  },
};

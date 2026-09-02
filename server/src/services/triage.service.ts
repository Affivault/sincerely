import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { leadsService } from './leads.service.js';
import { crmService } from './crm.service.js';
import { suppressionService } from './suppression.service.js';
import { promoteToContact } from './lifecycle.service.js';
import {
  DEFAULT_SNOOZE_DAYS,
  leadTitleFrom,
  NOT_INTERESTED_REASONS,
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

/** The counterparty on a message, whichever way it was going. */
function counterparty(message: any): string | null {
  const raw = message.direction === 'outbound'
    ? (message.contact_email || message.to_email)
    : (message.contact_email || message.from_email);
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

    const { data: message } = await supabaseAdmin
      .from('emails')
      .select('id, user_id, subject, from_email, to_email, direction, contact_id, contact_email, campaign_id')
      .eq('id', messageId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!message) throw new AppError('Message not found', 404);

    const email = counterparty(message);

    switch (decision) {
      case 'interested':
        return this.markInterested(userId, message, email, input);
      case 'later':
        return this.markLater(userId, message, email, input);
      case 'not_interested':
        return this.markNotInterested(userId, message, email, input);
      default:
        throw new AppError(`Unknown decision "${decision}"`, 400);
    }
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

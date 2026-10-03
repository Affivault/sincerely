/* ═══════════════════════════════════════════════════════════════════════
   Holding follow-ups while somebody is away.

   See shared/away for how the return date is read. This is what happens
   with it: every live enrolment for that person whose next email would go
   before they are back is moved to the day after, and the contact carries
   a note saying so (migration 080), so nobody wonders why a sequence went
   quiet. Nothing is stopped - an out-of-office is not an answer - and a
   sequence already due later than that is left exactly as it was.

   Never throws: an absence that cannot be recorded must not break a sync.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { readAbsence, type AbsenceReading } from '@lemlist/shared';

let columnsMissing = false;

export interface AbsenceHold extends AbsenceReading {
  /** Enrolments whose next email was moved. */
  held: number;
}

export async function holdForAbsence(userId: string, contactId: string, message: {
  subject?: string | null; bodyText?: string | null; receivedAt?: string | null;
}): Promise<AbsenceHold | null> {
  try {
    const reading = readAbsence(`${message.subject || ''}\n${message.bodyText || ''}`, message.receivedAt || Date.now());

    // Only this account's contact, and only enrolments still going.
    const { data: contact } = await supabaseAdmin
      .from('contacts').select('id').eq('id', contactId).eq('user_id', userId).maybeSingle();
    if (!contact) return null;

    const { data: moved, error } = await supabaseAdmin
      .from('campaign_contacts')
      .update({ next_send_at: reading.resume_at })
      .eq('contact_id', contactId)
      .in('status', ['pending', 'active'])
      .not('next_send_at', 'is', null)
      .lt('next_send_at', reading.resume_at)
      .select('id');
    if (error) console.error(`[Absence] Could not hold follow-ups for ${contactId}: ${error.message}`);

    if (!columnsMissing) {
      const { error: noteErr } = await supabaseAdmin
        .from('contacts')
        .update({ away_until: reading.resume_at, away_returns_on: reading.returns_on, away_note: reading.phrase })
        .eq('id', contactId)
        .eq('user_id', userId)
        // An older out-of-office reached during backfill must not replace a later hold.
        .or(`away_until.is.null,away_until.lt.${reading.resume_at}`);
      if (noteErr && /away_/.test(noteErr.message)) columnsMissing = true;
    }

    const held = (moved || []).length;
    if (held) console.log(`[Absence] ${contactId}: ${held} follow-up(s) held until ${reading.resume_at.slice(0, 10)}${reading.returns_on ? ` (back ${reading.returns_on})` : ' (no date given)'}`);
    return { ...reading, held };
  } catch (err: any) {
    console.error(`[Absence] ${contactId}: ${err?.message || err}`);
    return null;
  }
}

/**
 * Undo a stop that an out-of-office caused.
 *
 * Inbox sync stops a sequence on anything that is not visibly automatic.
 * An out-of-office that its headers and opening lines did not give away
 * was therefore recorded as the person replying, and their sequence ended
 * - the opposite of what should happen. When Relay then reads it as an
 * out-of-office, the enrolment is put back and held instead, but only if
 * this message is the only reply on it: anything a person wrote stands.
 */
export async function reinstateAfterAutoReply(userId: string, message: {
  id: string; contact_id: string | null; campaign_contact_id: string | null;
  subject?: string | null; body_text?: string | null; received_at?: string | null;
}): Promise<boolean> {
  try {
    if (!message.campaign_contact_id || !message.contact_id) return false;
    const { data: cc } = await supabaseAdmin
      .from('campaign_contacts')
      .select('id, status, campaigns!inner(user_id)')
      .eq('id', message.campaign_contact_id)
      .eq('campaigns.user_id', userId)
      .maybeSingle();
    if (!cc || (cc as any).status !== 'replied') return false;

    const { data: replies } = await supabaseAdmin
      .from('campaign_activities')
      .select('id, metadata')
      .eq('campaign_contact_id', message.campaign_contact_id)
      .eq('activity_type', 'replied');
    const others = (replies || []).filter((r: any) => r.metadata?.inbox_message_id !== message.id);
    if (others.length > 0 || (replies || []).length === 0) return false;

    const reading = readAbsence(`${message.subject || ''}\n${message.body_text || ''}`, message.received_at || Date.now());
    const { data: back } = await supabaseAdmin
      .from('campaign_contacts')
      .update({ status: 'active', completed_at: null, next_send_at: reading.resume_at })
      .eq('id', message.campaign_contact_id)
      .eq('status', 'replied')
      .select('id');
    if (!back?.length) return false;
    await supabaseAdmin
      .from('campaign_activities')
      .update({ activity_type: 'auto_reply', metadata: { ...((replies![0] as any).metadata || {}), auto_reply_kind: 'out_of_office', auto_reply_reason: 'read by Relay' } })
      .eq('id', (replies![0] as any).id);
    await holdForAbsence(userId, message.contact_id, { subject: message.subject, bodyText: message.body_text, receivedAt: message.received_at });
    console.log(`[Absence] ${message.campaign_contact_id}: an out-of-office had stopped this sequence; put back and held until ${reading.resume_at.slice(0, 10)}`);
    return true;
  } catch (err: any) {
    console.error(`[Absence] reinstate ${message.campaign_contact_id}: ${err?.message || err}`);
    return false;
  }
}

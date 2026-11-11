import { supabaseAdmin } from '../config/supabase.js';
import { chunk } from '../utils/batch.js';
import { MANUAL_PAUSE_PREFIX } from '@lemlist/shared';

/**
 * Somebody booked a meeting: stop emailing them.
 *
 * Every live enrolment of theirs in this account ends, the way "Stop for
 * them" in the inbox does (status 'paused' with a by-hand reason), so they
 * read as Sequence ended and no company-wide "resume" starts them again.
 * Sending a follow-up to someone who has just put a call in the diary is
 * the one thing an outreach tool must never do.
 *
 * Used for bookings through a Sincerely link, Calendly and Cal.com.
 * Returns how many sequences it stopped. Never throws.
 */
export async function stopSequencesForMeeting(userId: string, contactId: string | null, via: string): Promise<number> {
  if (!contactId) return 0;
  try {
    const { data: live, error } = await supabaseAdmin
      .from('campaign_contacts')
      .select('id, campaigns!inner(user_id)')
      .eq('contact_id', contactId)
      .eq('campaigns.user_id', userId)
      .in('status', ['pending', 'active']);
    if (error) throw error;
    let stopped = 0;
    for (const slice of chunk((live || []).map((r: any) => r.id as string))) {
      const { data, error: upErr } = await supabaseAdmin
        .from('campaign_contacts')
        .update({ status: 'paused', next_send_at: null, error_message: `${MANUAL_PAUSE_PREFIX}: booked a meeting${via ? ` ${via}` : ''}` })
        .in('id', slice)
        .in('status', ['pending', 'active'])
        .select('id');
      if (upErr) throw upErr;
      stopped += (data || []).length;
    }
    return stopped;
  } catch (err: any) {
    console.warn(`[Meetings] Could not stop sequences for ${contactId}: ${err?.message || err}`);
    return 0;
  }
}

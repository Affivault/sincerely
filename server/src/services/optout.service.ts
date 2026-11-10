import { supabaseAdmin } from '../config/supabase.js';
import { suppressionService } from './suppression.service.js';
import { fireEvent } from './webhook.service.js';
import { chunk } from '../utils/batch.js';

/**
 * Unsubscribes and bounces that arrive from outside the app (the public API,
 * a CRM sync), handled the way the unsubscribe link and a bounce notice are:
 * the contact is flagged, every live sequence they are in stops, and the
 * address goes on the suppression list so no import or campaign can email
 * it again.
 */

const LIVE = ['pending', 'active', 'paused'];

async function stopLiveEnrolments(userId: string, contactId: string, status: 'unsubscribed' | 'bounced'): Promise<number> {
  const { data: live, error } = await supabaseAdmin
    .from('campaign_contacts')
    .select('id, campaigns!inner(user_id)')
    .eq('contact_id', contactId)
    .eq('campaigns.user_id', userId)
    .in('status', LIVE);
  if (error) throw error;
  let stopped = 0;
  for (const slice of chunk((live || []).map((r: any) => r.id as string))) {
    const { error: stopErr } = await supabaseAdmin.from('campaign_contacts').update({ status, next_send_at: null }).in('id', slice);
    if (stopErr) throw stopErr;
    stopped += slice.length;
  }
  return stopped;
}

/**
 * Unsubscribe one contact. `source` names where it came from ('api',
 * 'hubspot', ...) and travels on the lead.unsubscribed event, so a CRM sync
 * does not send an unsubscribe straight back to the CRM it came from.
 */
export async function unsubscribeContact(
  userId: string,
  contactId: string,
  opts: { source: string; note: string },
): Promise<{ already: boolean; email: string | null }> {
  const { data: row, error } = await supabaseAdmin
    .from('contacts').select('id, email, is_unsubscribed').eq('id', contactId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!row) return { already: false, email: null };
  const already = !!(row as any).is_unsubscribed;

  if (!already) {
    const { error: upErr } = await supabaseAdmin.from('contacts').update({ is_unsubscribed: true }).eq('id', contactId).eq('user_id', userId);
    if (upErr) throw upErr;
  }
  await stopLiveEnrolments(userId, contactId, 'unsubscribed');
  if ((row as any).email) await suppressionService.add(userId, (row as any).email, 'unsubscribed', opts.note);
  if (!already) fireEvent(userId, 'lead.unsubscribed', { contact_id: contactId, source: opts.source }).catch(() => {});
  return { already, email: (row as any).email ?? null };
}

/**
 * Mark one contact's address as bouncing. No event is fired: an
 * email.bounced event means a campaign email bounced, which this was not.
 * An address already suppressed for another reason (an unsubscribe) keeps
 * that reason.
 */
export async function markContactBounced(
  userId: string,
  contactId: string,
  opts: { note: string },
): Promise<{ already: boolean; email: string | null }> {
  const { data: row, error } = await supabaseAdmin
    .from('contacts').select('id, email, is_bounced').eq('id', contactId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!row) return { already: false, email: null };
  const already = !!(row as any).is_bounced;
  if (!already) {
    const { error: upErr } = await supabaseAdmin.from('contacts').update({ is_bounced: true }).eq('id', contactId).eq('user_id', userId);
    if (upErr) throw upErr;
  }
  await stopLiveEnrolments(userId, contactId, 'bounced');
  const email = (row as any).email as string | null;
  if (email) {
    const existing = await suppressionService.reasonFor(userId, email);
    if (!existing) await suppressionService.add(userId, email, 'bounced', opts.note);
  }
  return { already, email };
}

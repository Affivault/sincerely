/* ═══════════════════════════════════════════════════════════════════════
   One yes pauses the rest of the company.

   The moment somebody at a company replies "interested" or asks for a
   meeting, every other cold sequence still running to their colleagues
   becomes a liability: the buyer forwards your email to their head of
   sales, and their head of sales gets step three of a cold sequence the
   next morning. That is how deals die before the first call.

   So a positive reply pauses those sequences. Paused, not stopped - the
   contact keeps their place in the sequence and is one click from resuming,
   because sometimes the colleague is exactly who you still want to reach.

   Consumer mailbox domains are never treated as a company: two people on
   gmail.com have nothing to do with each other.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { emailDomain, isFreeMailDomain } from '@lemlist/shared';
import { AppError } from '../middleware/error.middleware.js';
import { chunk } from '../utils/batch.js';

/** The note left on a paused enrolment. Also how a resume recognises one. */
export const COMPANY_PAUSE_PREFIX = 'Paused: ';

/** Most colleagues looked at per reply. A company bigger than this is not one relationship. */
const MAX_COLLEAGUES = 500;

export function companyPauseNote(who: string, domain: string, intent: string): string {
  return `${COMPANY_PAUSE_PREFIX}${who} at ${domain} replied (${intent.replace(/_/g, ' ')})`;
}

/**
 * Pause every live enrolment of the replier's colleagues. Returns how many
 * enrolments were paused. Never throws: this rides along with reply
 * classification, which must not fail because of it.
 */
export async function pauseColleaguesAfterReply(input: {
  userId: string;
  replierEmail: string;
  replierContactId?: string | null;
  replierName?: string | null;
  intent: string;
}): Promise<number> {
  try {
    const domain = emailDomain(input.replierEmail);
    if (!domain || isFreeMailDomain(domain)) return 0;

    const { data: colleagues, error } = await supabaseAdmin
      .from('contacts')
      .select('id, email')
      .eq('user_id', input.userId)
      .ilike('email', `%@${domain.replace(/[%_]/g, '')}`)
      .limit(MAX_COLLEAGUES);
    if (error) throw new Error(error.message);

    const replier = input.replierEmail.trim().toLowerCase();
    const ids = (colleagues || [])
      .filter((c: any) => c.id !== input.replierContactId && String(c.email || '').toLowerCase() !== replier)
      // The ilike above also matches sub.domain.com; keep exact domains only.
      .filter((c: any) => emailDomain(c.email) === domain)
      .map((c: any) => c.id as string);
    if (ids.length === 0) return 0;

    const note = companyPauseNote(input.replierName || input.replierEmail, domain, input.intent);
    let paused = 0;
    for (const slice of chunk(ids)) {
      const { data, error: upErr } = await supabaseAdmin
        .from('campaign_contacts')
        .update({ status: 'paused', next_send_at: null, error_message: note })
        .in('contact_id', slice)
        .in('status', ['pending', 'active'])
        .select('id');
      if (upErr) throw new Error(upErr.message);
      paused += (data || []).length;
    }
    if (paused > 0) console.log(`[AccountPause] Paused ${paused} enrolment(s) at ${domain} after a positive reply`);
    return paused;
  } catch (err: any) {
    console.error('[AccountPause] Could not pause colleagues (reply unaffected):', err?.message || err);
    return 0;
  }
}

/**
 * Put paused enrolments of one campaign back to work. With no ids, resumes
 * every paused enrolment in the campaign. Returns how many resumed.
 */
export async function resumePausedContacts(
  userId: string,
  campaignId: string,
  campaignContactIds?: string[],
): Promise<number> {
  const { data: campaign, error: cErr } = await supabaseAdmin
    .from('campaigns')
    .select('id, user_id, status')
    .eq('id', campaignId)
    .maybeSingle();
  if (cErr) throw new AppError(cErr.message, 500);
  if (!campaign || campaign.user_id !== userId) throw new AppError('Campaign not found', 404);

  let query = supabaseAdmin
    .from('campaign_contacts')
    .select('id')
    .eq('campaign_id', campaignId)
    .eq('status', 'paused');
  if (campaignContactIds && campaignContactIds.length > 0) {
    query = query.in('id', campaignContactIds.slice(0, 1000));
  }
  const { data: rows, error } = await query.limit(5000);
  if (error) throw new AppError(error.message, 500);
  if (!rows || rows.length === 0) return 0;

  // A campaign that has not launched yet keeps them pending; launch will
  // activate them with everyone else. A live one only sends to active
  // contacts, so they go straight back to active and due now.
  const launched = !['draft'].includes(campaign.status);
  const now = new Date().toISOString();
  const patch = launched
    ? { status: 'active', next_send_at: now, error_message: null }
    : { status: 'pending', next_send_at: null, error_message: null };
  let resumed = 0;
  for (const slice of chunk(rows.map((r: any) => r.id as string))) {
    const { data, error: upErr } = await supabaseAdmin
      .from('campaign_contacts')
      .update(patch)
      .in('id', slice)
      .eq('status', 'paused')
      .select('id');
    if (upErr) throw new AppError(upErr.message, 500);
    resumed += (data || []).length;
  }

  // Paused enrolments keep a campaign from completing, but one that
  // completed before this shipped needs to run again to send.
  if (resumed > 0 && campaign.status === 'completed') {
    await supabaseAdmin.from('campaigns')
      .update({ status: 'running', completed_at: null })
      .eq('id', campaignId).eq('status', 'completed');
  }
  return resumed;
}

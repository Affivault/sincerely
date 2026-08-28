import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { shouldPromote } from '@lemlist/shared';
import type { Lifecycle, PromotionTrigger } from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Moving somebody from stranger to relationship.

   Called from wherever the causing event actually happens — a reply
   landing, a meeting being booked, a deal gaining a participant — rather
   than from a nightly job, so the CRM is right the moment it becomes
   right. A person who replies at 09:04 should be a contact at 09:04.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Promote contacts, but only ever forwards.
 *
 * Reads the current lifecycle first so a customer replying to a nurture
 * campaign is not quietly demoted back to a contact, and so a promotion is
 * not rewritten with a later, weaker trigger.
 *
 * Deliberately never throws. Every caller is doing something else that
 * matters more — saving a reply, creating a deal — and none of them should
 * fail because a bookkeeping column could not be updated.
 */
export async function promote(
  userId: string,
  contactIds: string[],
  to: Lifecycle,
  trigger: PromotionTrigger,
): Promise<number> {
  const ids = [...new Set(contactIds.filter(Boolean))];
  if (ids.length === 0) return 0;

  try {
    const { data: current, error } = await supabaseAdmin
      .from('contacts')
      .select('id, lifecycle')
      .eq('user_id', userId)
      .in('id', ids);
    if (error) throw error;

    const needed = (current || [])
      .filter((c: any) => shouldPromote(c.lifecycle, to))
      .map((c: any) => c.id);
    if (needed.length === 0) return 0;

    const { error: upErr } = await supabaseAdmin
      .from('contacts')
      .update({ lifecycle: to, engaged_at: new Date().toISOString(), promoted_by: trigger })
      .eq('user_id', userId)
      .in('id', needed);
    if (upErr) throw upErr;

    return needed.length;
  } catch (e: any) {
    console.error('[Lifecycle] promote failed:', e?.message || e);
    return 0;
  }
}

/** Somebody engaged. The commonest promotion by a wide margin. */
export function promoteToContact(userId: string, contactIds: string[], trigger: PromotionTrigger) {
  return promote(userId, contactIds, 'contact', trigger);
}

/** A deal was won. They are not a prospect any more, in any sense. */
export function promoteToCustomer(userId: string, contactIds: string[]) {
  return promote(userId, contactIds, 'customer', 'deal');
}

/**
 * Everybody on a deal: the named contact and every participant.
 *
 * Winning a deal makes customers of all of them, not just whoever happened
 * to be typed into the contact field.
 */
export async function contactIdsOnDeal(userId: string, dealId: string): Promise<string[]> {
  const ids: string[] = [];
  try {
    const { data: deal } = await supabaseAdmin
      .from('deals').select('contact_id')
      .eq('id', dealId).eq('user_id', userId).maybeSingle();
    if (deal?.contact_id) ids.push(deal.contact_id);

    const { data: parts } = await supabaseAdmin
      .from('deal_participants').select('contact_id')
      .eq('deal_id', dealId).eq('user_id', userId);
    for (const p of parts || []) if (p.contact_id) ids.push(p.contact_id);
  } catch (e: any) {
    console.error('[Lifecycle] could not read deal contacts:', e?.message || e);
  }
  return [...new Set(ids)];
}

/**
 * Contacts who are on an open deal, out of the ones asked about.
 *
 * Unlike everything above, this one throws. The others are bookkeeping and
 * must never fail the thing that triggered them; this is a guard, and a
 * guard that fails quietly returns an empty set — which reads as "nobody is
 * on a deal" and sends the cold pitch anyway. Failing the enrolment is the
 * better outcome by a wide margin.
 *
 * Lives here rather than with leads so the enrolment path does not have to
 * import the whole CRM chain to ask one question.
 *
 * Used to keep somebody you are mid-negotiation with out of a cold
 * campaign. Covers participants as well as the primary contact, because
 * emailing the security reviewer a cold pitch while their colleague is
 * signing a contract is the same mistake.
 */
export async function contactsOnOpenDeals(userId: string, contactIds: string[]): Promise<Set<string>> {
  const on = new Set<string>();
  if (contactIds.length === 0) return on;

  const CHUNK = 200;
  for (let i = 0; i < contactIds.length; i += CHUNK) {
    const slice = contactIds.slice(i, i + CHUNK);

    const { data: primary, error: e1 } = await supabaseAdmin
      .from('deals').select('contact_id')
      .eq('user_id', userId)
      .in('contact_id', slice)
      .in('stage', ['lead', 'qualified', 'proposal']);
    if (e1) throw new AppError(e1.message, 500);
    for (const row of primary || []) if (row.contact_id) on.add(row.contact_id);

    const { data: joined, error: e2 } = await supabaseAdmin
      .from('deal_participants')
      .select('contact_id, deal:deals!inner(stage)')
      .eq('user_id', userId)
      .in('contact_id', slice)
      .in('deal.stage', ['lead', 'qualified', 'proposal']);
    if (e2) throw new AppError(e2.message, 500);
    for (const row of joined || []) if (row.contact_id) on.add(row.contact_id);
  }
  return on;
}

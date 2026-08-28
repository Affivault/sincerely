import { supabaseAdmin } from '../config/supabase.js';
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

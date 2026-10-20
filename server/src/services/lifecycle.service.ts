import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { shouldPromote, SaraIntent } from '@lemlist/shared';
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

/* ───────────────────────────────────────────────────────────────────────
   Which events are allowed to do it (Settings -> Preferences, migration 087).
   ─────────────────────────────────────────────────────────────────────── */

export type ReplyPromotion = 'any' | 'positive' | 'off';

export interface PromotionSettings {
  /** Off: nobody moves on their own; moving is done by hand. */
  enabled: boolean;
  on_reply: ReplyPromotion;
  on_meeting: boolean;
  /** Made a lead, or put on a deal. */
  on_deal: boolean;
}

/** What the app did before these were settings, so nothing changes unasked. */
export const DEFAULT_PROMOTION: PromotionSettings = {
  enabled: true, on_reply: 'any', on_meeting: true, on_deal: true,
};

/**
 * Read with select('*') so a database without 087 still answers, with the
 * defaults. A failed read also falls back to the defaults: this gates
 * bookkeeping, and the defaults are what the account had before.
 */
export async function promotionSettings(userId: string): Promise<PromotionSettings> {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_settings').select('*').eq('user_id', userId).maybeSingle();
    if (error || !data) return DEFAULT_PROMOTION;
    const d = data as any;
    const onReply = ['any', 'positive', 'off'].includes(d.contact_promote_on_reply)
      ? d.contact_promote_on_reply as ReplyPromotion
      : DEFAULT_PROMOTION.on_reply;
    return {
      enabled: d.contact_auto_promote !== false,
      on_reply: onReply,
      on_meeting: d.contact_promote_on_meeting !== false,
      on_deal: d.contact_promote_on_deal !== false,
    };
  } catch {
    return DEFAULT_PROMOTION;
  }
}

/** Whether the account lets this kind of event move somebody. */
export function triggerAllowed(s: PromotionSettings, trigger: PromotionTrigger): boolean {
  // Somebody choosing it - an import filed as contacts, a button - is not
  // automatic, and the switch is about what happens without being asked.
  if (trigger === 'manual' || trigger === 'import') return true;
  if (!s.enabled) return false;
  switch (trigger) {
    case 'reply': return s.on_reply !== 'off';
    case 'meeting': return s.on_meeting;
    case 'lead':
    case 'deal': return s.on_deal;
    default: return true;
  }
}

/**
 * Somebody engaged. The commonest promotion by a wide margin.
 *
 * Gated by the account's settings, and never touches anybody who was moved
 * back to Prospects by hand: a deliberate choice outranks an event, so a
 * person you parked stays parked until you move them yourself.
 */
export async function promoteToContact(userId: string, contactIds: string[], trigger: PromotionTrigger) {
  const ids = [...new Set(contactIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  if (trigger === 'manual' || trigger === 'import') return promote(userId, ids, 'contact', trigger);
  try {
    if (!triggerAllowed(await promotionSettings(userId), trigger)) return 0;
    const { data: held, error } = await supabaseAdmin
      .from('contacts').select('id')
      .eq('user_id', userId).in('id', ids)
      .eq('lifecycle', 'prospect').eq('promoted_by', 'manual');
    if (error) throw error;
    const parked = new Set((held || []).map((r: any) => r.id));
    return promote(userId, ids.filter((id) => !parked.has(id)), 'contact', trigger);
  } catch (e: any) {
    console.error('[Lifecycle] promoteToContact failed:', e?.message || e);
    return 0;
  }
}

/** Reply intents that never make a contact, whatever the settings say. */
const NEVER_PROMOTES = new Set<string>([
  SaraIntent.OutOfOffice, SaraIntent.Unsubscribe, SaraIntent.Bounce,
]);
const POSITIVE = new Set<string>([SaraIntent.Interested, SaraIntent.Meeting]);

/** Addresses that are machines by name, whatever the message says. */
const MACHINE_SENDER = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?|notifications?|auto-?(reply|responder)?)([+._-][^@]*)?@/i;

export function isMachineSender(email: string | null | undefined): boolean {
  return MACHINE_SENDER.test(String(email || '').trim());
}

/** Whether a reply read as `intent` is enough to make a contact under `rule`. */
export function replyQualifies(intent: string | null | undefined, rule: ReplyPromotion): boolean {
  if (rule === 'off') return false;
  const i = intent || SaraIntent.Other;
  if (NEVER_PROMOTES.has(i)) return false;
  return rule === 'any' ? true : POSITIVE.has(i);
}

/**
 * A reply arrived and has been read. The one place a reply promotes.
 *
 * The caller has already ruled out what the headers and the inbox give
 * away (auto-replies, bounces, complaints, newsletters). This adds the
 * sender address, the read of what they wrote, and the account's rule.
 */
export async function promoteFromReply(
  userId: string,
  contactId: string | null | undefined,
  reply: { intent: string | null | undefined; fromEmail?: string | null },
): Promise<number> {
  if (!contactId || isMachineSender(reply.fromEmail)) return 0;
  const s = await promotionSettings(userId);
  if (!s.enabled || !replyQualifies(reply.intent, s.on_reply)) return 0;
  return promoteToContact(userId, [contactId], 'reply');
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

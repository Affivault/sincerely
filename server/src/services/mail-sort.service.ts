/* ═══════════════════════════════════════════════════════════════════════
   Sorting the mail that arrived before sorting existed.

   New mail is sorted as it is synced, from its headers. Everything already
   stored has no headers left, so it is sorted here from what was kept: the
   sender, the subject, the body. It runs in the background the first time
   the inbox is opened, a page at a time, and the inbox counts say so while
   it does.

   While it is at it, Relay's old keyword readings are read again with the
   quoted history removed. When a reply it had filed as "unsubscribe" turns
   out to say something else, the old reading is kept in
   relay_previous_intent - and if Relay acted on it and unsubscribed a real
   person, that person is offered back (see relayReview) rather than
   silently resubscribed: whether to email them again is the user's call.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { SaraIntent } from '@lemlist/shared';
import { classifyMailKind, htmlToText, NON_PERSON_KINDS, type MailKind } from '../utils/mail-kind.js';
import { classifyReply } from './sara.service.js';
import { suppressionService } from './suppression.service.js';
import { AppError } from '../middleware/error.middleware.js';

const running = new Set<string>();
const finished = new Set<string>();
const PAGE = 400;

async function emailSet(userId: string, table: 'contacts' | 'outbound'): Promise<Set<string>> {
  const set = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const q = table === 'contacts'
      ? supabaseAdmin.from('contacts').select('email').eq('user_id', userId).range(from, from + 999)
      : supabaseAdmin.from('inbox_messages').select('to_email').eq('user_id', userId).eq('direction', 'outbound').range(from, from + 999);
    const { data, error } = await q;
    if (error || !data?.length) break;
    for (const r of data as any[]) {
      const e = String(r.email ?? r.to_email ?? '').trim().toLowerCase();
      if (e) set.add(e);
    }
    if (data.length < 1000) break;
  }
  return set;
}

async function sortAll(userId: string): Promise<void> {
  const [contacts, wroteTo, own] = await Promise.all([
    emailSet(userId, 'contacts'),
    emailSet(userId, 'outbound'),
    supabaseAdmin.from('smtp_accounts').select('email_address').eq('user_id', userId)
      .then(({ data }) => new Set((data || []).map((r: any) => String(r.email_address || '').toLowerCase()))),
  ]);

  for (let guard = 0; guard < 200; guard++) {
    const { data: rows, error } = await supabaseAdmin
      .from('inbox_messages')
      .select('id, from_email, subject, body_text, body_html, sara_intent, relay_engine, contact_id, campaign_id')
      .eq('user_id', userId)
      .eq('direction', 'inbound')
      .is('mail_kind', null)
      .order('received_at', { ascending: false })
      .limit(PAGE);
    // Column missing = migration 076 not run yet. Nothing to do until it is.
    if (error || !rows?.length) return;

    const byKind = new Map<MailKind, string[]>();
    const rereads: Array<{ id: string; intent: string; previous: string }> = [];
    const clearIntent: string[] = [];

    for (const r of rows as any[]) {
      const from = String(r.from_email || '').toLowerCase().trim();
      const kind = classifyMailKind({
        fromEmail: from,
        subject: r.subject,
        bodyText: r.body_text,
        bodyHtml: r.body_html,
        known: !!r.contact_id || !!r.campaign_id || contacts.has(from) || wroteTo.has(from),
        own: own.has(from),
      }).kind;
      byKind.set(kind, [...(byKind.get(kind) || []), r.id]);

      if (NON_PERSON_KINDS.includes(kind)) {
        if (r.sara_intent) clearIntent.push(r.id);
      } else if (r.sara_intent === SaraIntent.Unsubscribe && !r.relay_engine) {
        // The old keyword reading of "unsubscribe" - the one that acted on
        // its own - done again on the new part only. Other intents are left
        // alone: a tag somebody set by hand lives in the same column, and a
        // wrong "interested" costs nothing a person cannot see and fix.
        const again = classifyReply(r.subject || '', r.body_text || htmlToText(r.body_html || '')).intent;
        if (again !== r.sara_intent) rereads.push({ id: r.id, intent: again, previous: r.sara_intent });
      }
    }

    for (const [kind, ids] of byKind) {
      for (let i = 0; i < ids.length; i += 200) {
        await supabaseAdmin.from('inbox_messages').update({ mail_kind: kind }).in('id', ids.slice(i, i + 200));
      }
    }
    // Mail keeps what Relay once thought, as history; it is no longer an intent.
    for (let i = 0; i < clearIntent.length; i += 200) {
      const ids = clearIntent.slice(i, i + 200);
      const { data: had } = await supabaseAdmin.from('inbox_messages').select('id, sara_intent').in('id', ids);
      for (const h of had || []) {
        await supabaseAdmin.from('inbox_messages')
          .update({ relay_previous_intent: h.sara_intent === SaraIntent.Unsubscribe ? h.sara_intent : null, sara_intent: null, sara_action: null, sara_draft_reply: null })
          .eq('id', h.id);
      }
    }
    for (const r of rereads) {
      await supabaseAdmin.from('inbox_messages')
        .update({ sara_intent: r.intent, relay_engine: 'rules', relay_previous_intent: r.previous })
        .eq('id', r.id);
    }
    if (rows.length < PAGE) return;
  }
}

export const mailSortService = {
  /** Start sorting if there is anything to sort. Returns whether it is running. */
  ensure(userId: string): boolean {
    if (running.has(userId)) return true;
    if (finished.has(userId)) return false;
    running.add(userId);
    sortAll(userId)
      .catch((e) => console.warn('[MailSort]', userId, e?.message || e))
      .finally(() => { running.delete(userId); finished.add(userId); });
    return true;
  },

  isSorting(userId: string): boolean {
    return running.has(userId);
  },

  /**
   * People Relay unsubscribed on a reading it no longer holds - usually a
   * reply that quoted your own campaign's footer. Offered back, never
   * resubscribed automatically.
   */
  async relayReview(userId: string) {
    const { data, error } = await supabaseAdmin
      .from('inbox_messages')
      .select('id, subject, body_text, sara_intent, mail_kind, received_at, contact_id, contacts!inner(id, email, first_name, last_name, company, is_unsubscribed)')
      .eq('user_id', userId)
      .eq('relay_previous_intent', SaraIntent.Unsubscribe)
      .eq('contacts.is_unsubscribed', true)
      .order('received_at', { ascending: false })
      .limit(100);
    if (error) return [];
    const seen = new Set<string>();
    const out: any[] = [];
    for (const m of (data || []) as any[]) {
      const c = m.contacts;
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      out.push({
        message_id: m.id,
        contact_id: c.id,
        email: c.email,
        name: [c.first_name, c.last_name].filter(Boolean).join(' ') || null,
        company: c.company || null,
        subject: m.subject,
        excerpt: String(m.body_text || '').trim().slice(0, 240),
        now_reads_as: m.mail_kind && m.mail_kind !== 'person' ? m.mail_kind : m.sara_intent,
        received_at: m.received_at,
      });
    }
    return out;
  },

  /** Put a wrongly unsubscribed person back: emailable, off the suppression list. */
  async restore(userId: string, contactId: string) {
    const { data: contact } = await supabaseAdmin
      .from('contacts').select('id, email').eq('id', contactId).eq('user_id', userId).maybeSingle();
    if (!contact) throw new AppError('Contact not found', 404);
    const { error: restoreErr } = await supabaseAdmin.from('contacts')
      .update({ is_unsubscribed: false }).eq('id', contactId).eq('user_id', userId);
    if (restoreErr) throw new AppError(restoreErr.message, 500);
    if (contact.email) await suppressionService.remove(userId, contact.email).catch(() => {});
    await supabaseAdmin.from('inbox_messages').update({ relay_previous_intent: null })
      .eq('user_id', userId).eq('contact_id', contactId).not('relay_previous_intent', 'is', null);
    return { restored: true };
  },

  /** Relay was right after all: stop offering this one. */
  async dismiss(userId: string, contactId: string) {
    await supabaseAdmin.from('inbox_messages').update({ relay_previous_intent: null })
      .eq('user_id', userId).eq('contact_id', contactId).not('relay_previous_intent', 'is', null);
    return { dismissed: true };
  },
};

/* Whether migration 076 has run. Checked lazily, remembered once true, and
   rechecked a minute later when not - so the inbox keeps working in the
   window between deploying this and running the migration. */
let ready = false;
let checkedAt = 0;
export async function mailKindReady(): Promise<boolean> {
  if (ready) return true;
  if (Date.now() - checkedAt < 60_000) return false;
  checkedAt = Date.now();
  const { error } = await supabaseAdmin.from('inbox_messages').select('mail_kind', { head: true, count: 'exact' }).limit(1);
  ready = !error;
  return ready;
}

/** PostgREST filter: a person wrote it, or it has not been sorted yet. */
export const PEOPLE_FILTER = 'mail_kind.is.null,mail_kind.eq.person';

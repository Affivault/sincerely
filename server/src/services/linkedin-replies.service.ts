import crypto from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { classifyReply } from './sara.service.js';
import { promoteFromReply } from './lifecycle.service.js';
import { markReplied, stopOtherCampaignsForContact } from './sequence.service.js';
import { SaraIntent } from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   LinkedIn replies, read by the agent and filed like email ones.

   The extension looks through the LinkedIn messaging list for the people
   on the watchlist (linkedin_reply_watchlist, 095) and reports what they
   wrote after the user's last message. This turns each report into what
   an email reply already turns into: a row in the inbox, a 'replied'
   activity that stops the sequence, and a promotion through the one
   lifecycle path that knows the account's rules.

   Nothing in a report is trusted to say who it is about. The contact id
   it carries is only acted on if it is on this account's watchlist as
   read here, so a forged report can at most file a message against
   somebody the account is already talking to.
   ═══════════════════════════════════════════════════════════════════════ */

/** What the extension sends for one conversation. */
export interface ReportedConversation {
  contact_id?: string;
  thread_id?: string;
  messages?: Array<{ id?: string | null; text?: string; at?: string | null }>;
}

export interface WatchEntry {
  contact_id: string;
  campaign_contact_id: string;
  contact_name: string | null;
  linkedin_url: string;
}

/** A report is a page of a messaging list, not an export of it. */
const MAX_CONVERSATIONS = 20;
const MAX_MESSAGES = 10;
const MAX_TEXT = 5000;

function isDuplicate(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '23505' || /duplicate key|already exists/i.test(error.message || '');
}

/**
 * The id a message is deduplicated on. LinkedIn's own event id when the
 * page showed one; otherwise the thread and the words, which is what a
 * second read of the same unchanged thread will produce again.
 */
function messageKey(threadId: string, m: { id?: string | null; text: string }): string {
  const own = String(m.id || '').trim();
  if (own) return `linkedin:${own.slice(0, 200)}`;
  const digest = crypto.createHash('sha256').update(`${threadId}\n${m.text}`).digest('hex').slice(0, 32);
  return `linkedin:${threadId.slice(0, 100)}:${digest}`;
}

function receivedAt(raw: unknown): string {
  const t = raw ? new Date(String(raw)).getTime() : NaN;
  // Never in the future, and never older than a year: a page-rendered
  // date that parsed oddly must not bury the reply or float it to the top.
  if (!Number.isFinite(t) || t > Date.now() + 60_000 || t < Date.now() - 365 * 86_400_000) {
    return new Date().toISOString();
  }
  return new Date(t).toISOString();
}

export async function replyWatchlist(userId: string, max = 100): Promise<WatchEntry[] | null> {
  const { data, error } = await supabaseAdmin.rpc('linkedin_reply_watchlist', { uid: userId, max_rows: max });
  if (error) {
    // Before 095 there is nothing to watch with.
    if ((error as any).code === 'PGRST202' || /linkedin_reply_watchlist/.test(error.message || '')) return null;
    throw new Error(`linkedin reply watchlist: ${error.message}`);
  }
  return (data || []) as WatchEntry[];
}

/**
 * File what the agent read. Returns how many messages were new and how
 * many conversations counted as a reply.
 */
export async function ingestLinkedinReplies(
  userId: string,
  conversations: ReportedConversation[],
): Promise<{ stored: number; replies: number }> {
  const list = (Array.isArray(conversations) ? conversations : []).slice(0, MAX_CONVERSATIONS);
  if (list.length === 0) return { stored: 0, replies: 0 };

  const watch = await replyWatchlist(userId, 500);
  if (!watch) return { stored: 0, replies: 0 };
  const byContact = new Map(watch.map((w) => [w.contact_id, w]));

  let stored = 0;
  let replies = 0;
  for (const convo of list) {
    const entry = byContact.get(String(convo.contact_id || ''));
    if (!entry) continue;
    const threadId = String(convo.thread_id || '').replace(/[^\w:.-]/g, '').slice(0, 120) || `contact-${entry.contact_id}`;

    const messages = (Array.isArray(convo.messages) ? convo.messages : [])
      .slice(-MAX_MESSAGES)
      .map((m) => ({ id: m?.id ?? null, text: String(m?.text || '').trim().slice(0, MAX_TEXT), at: m?.at ?? null }))
      .filter((m) => m.text);
    if (messages.length === 0) continue;

    try {
      const outcome = await fileConversation(userId, entry, threadId, messages);
      stored += outcome.stored;
      if (outcome.replied) replies++;
    } catch (err: any) {
      // One conversation failing must not lose the others in the report.
      console.error(`[LinkedIn] Could not file a reply for contact ${entry.contact_id}:`, err?.message || err);
    }
  }
  return { stored, replies };
}

async function fileConversation(
  userId: string,
  entry: WatchEntry,
  threadId: string,
  messages: Array<{ id: string | null; text: string; at: unknown }>,
): Promise<{ stored: number; replied: boolean }> {
  const { data: contact } = await supabaseAdmin
    .from('contacts')
    .select('id, email, first_name, last_name')
    .eq('id', entry.contact_id)
    .eq('user_id', userId)
    .maybeSingle();
  if (!contact) return { stored: 0, replied: false };

  const { data: enrolment } = await supabaseAdmin
    .from('campaign_contacts')
    .select('id, campaign_id, campaigns!inner(user_id, stop_on_reply)')
    .eq('id', entry.campaign_contact_id)
    .maybeSingle();
  // The watchlist read the enrolment a moment ago; a campaign deleted in
  // between still leaves the message worth keeping in the inbox.
  const campaignOk = !!enrolment && (enrolment as any).campaigns?.user_id === userId;

  const name = entry.contact_name
    || [contact.first_name, contact.last_name].filter(Boolean).join(' ')
    || null;

  const fresh: Array<{ id: string; key: string; text: string }> = [];
  for (const m of messages) {
    const key = messageKey(threadId, m);
    const row: Record<string, any> = {
      user_id: userId,
      contact_id: contact.id,
      // The inbox groups and avatars by address, so the contact's email is
      // used when there is one. There is no address to answer to on
      // LinkedIn, and the inbox knows not to offer an email reply here.
      from_email: contact.email || '',
      to_email: 'linkedin',
      subject: 'LinkedIn message',
      body_text: m.text,
      direction: 'inbound',
      is_read: false,
      received_at: receivedAt(m.at),
      message_id: key,
      thread_id: `linkedin:${threadId}`,
      channel: 'linkedin',
      sender_name: name,
      mail_kind: 'person',
    };
    if (campaignOk) {
      row.campaign_id = (enrolment as any).campaign_id;
      row.campaign_contact_id = enrolment!.id;
    }
    const { data: saved, error } = await supabaseAdmin
      .from('inbox_messages')
      .insert(row)
      .select('id')
      .maybeSingle();
    // Read before, on an earlier pass: the unique index on (user_id,
    // message_id) is the dedupe, and losing that race is success.
    if (isDuplicate(error)) continue;
    if (error || !saved) throw new Error(error?.message || 'insert returned nothing');
    fresh.push({ id: saved.id, key, text: m.text });
  }
  if (fresh.length === 0) return { stored: 0, replied: false };

  const latest = fresh[fresh.length - 1];
  const intent = classifyReply('', fresh.map((f) => f.text).join('\n\n')).intent;
  // LinkedIn has no autoresponder headers, so "I'm away until Monday" is
  // only recognisable from the words. It is filed, but it is not an answer
  // and it must not stop the sequence or promote anybody.
  const away = intent === SaraIntent.OutOfOffice;

  // Shown on the inbox row the same way a classified email reply is.
  await supabaseAdmin.from('inbox_messages')
    .update({ sara_intent: intent })
    .eq('id', latest.id)
    .eq('user_id', userId)
    .then(() => {}, () => {});

  if (!campaignOk) return { stored: fresh.length, replied: false };

  const { error: actErr } = await supabaseAdmin.from('campaign_activities').insert({
    campaign_id: (enrolment as any).campaign_id,
    campaign_contact_id: enrolment!.id,
    contact_id: contact.id,
    activity_type: away ? 'auto_reply' : 'replied',
    message_id: latest.key,
    metadata: {
      channel: 'linkedin',
      from: name,
      inbox_message_id: latest.id,
      thread_id: threadId,
      ...(away ? { auto_reply_kind: 'out_of_office' } : {}),
    },
  });
  if (actErr) console.error('[LinkedIn] Could not record the reply activity:', actErr.message);
  if (away) return { stored: fresh.length, replied: false };

  if ((enrolment as any).campaigns?.stop_on_reply !== false) {
    await markReplied(enrolment!.id);
    await stopOtherCampaignsForContact(userId, contact.id, enrolment!.id);
  }
  await promoteFromReply(userId, contact.id, { intent, fromEmail: contact.email })
    .catch((e: any) => console.warn('[LinkedIn] promotion after reply failed:', e?.message || e));
  return { stored: fresh.length, replied: true };
}

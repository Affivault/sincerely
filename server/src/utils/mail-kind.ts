/* ═══════════════════════════════════════════════════════════════════════
   Is this a person, or mail?

   The Unibox read every message in every connected mailbox and treated
   each one as somebody answering you. A newsletter from a broker, a
   Spacemail receipt, a GitHub notification and a Brevo welcome series all
   sat in the same list as a prospect saying "yes, let's talk", and every
   count the product shows - unread, needs reply, hot leads, "things that
   need a decision" - was mostly made of them.

   Worse, the reply agent read them too. Almost every bulk email carries
   the word "unsubscribe" in its footer, so almost every newsletter was
   filed as a person asking to be unsubscribed.

   So each inbound message gets a kind, decided once when it arrives:

     person         somebody wrote to you
     bulk           a newsletter or marketing send
     notification   a machine telling you something (alerts, no-reply)
     transactional  receipts, invoices, renewals, security codes
     internal       between your own connected mailboxes

   Only people reach the inbox, the counts, and the reply agent. Everything
   else lives under "Other mail", one click away and never lost.

   Headers decide when they are present - they are what bulk senders are
   required to set. Stored messages that predate this have no headers, so
   the same questions are also asked of the sender and the body, more
   cautiously. When in doubt, a message is a person: hiding a real reply is
   far worse than showing a newsletter.
   ═══════════════════════════════════════════════════════════════════════ */

import type { MailKind } from '@lemlist/shared';
import { stripQuoted, htmlToText } from '@lemlist/shared';
export type { MailKind };
export { stripQuoted, htmlToText };

export const NON_PERSON_KINDS: MailKind[] = ['bulk', 'notification', 'transactional', 'internal'];

export interface MailKindInput {
  /** Parsed headers (mailparser Map or plain object). Absent for backfills. */
  headers?: unknown;
  fromEmail: string;
  fromName?: string | null;
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  /** The sender is one of your contacts, or someone you have written to. */
  known?: boolean;
  /** The sender is one of your own connected mailboxes. */
  own?: boolean;
}

export interface MailKindVerdict {
  kind: MailKind;
  reason: string;
}

function headerMap(headers: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  const entries: [unknown, unknown][] =
    headers instanceof Map ? [...headers.entries()]
      : typeof headers === 'object' ? Object.entries(headers as Record<string, unknown>) : [];
  for (const [k, v] of entries) {
    const key = String(k).toLowerCase().trim();
    let value = '';
    if (typeof v === 'string') value = v;
    else if (Array.isArray(v)) value = v.map(String).join(' ');
    else if (v && typeof v === 'object') value = String((v as any).value ?? (v as any).text ?? JSON.stringify(v));
    else if (v != null) value = String(v);
    out[key] = value.trim();
  }
  return out;
}

/** Local parts only machines use. */
const MACHINE_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|noreply[-.\w]*|notifications?|notify|alerts?|mailer(-daemon)?|bounces?|postmaster|automated|system|updates?|news(letter)?s?|marketing|promo(tions)?|digest|announce(ments)?|receipts?|billing|invoices?|orders?|accounts?|security|verify|verification)([-+.]|$)/i;

/** Services whose mail is always notifications, whoever the sender address is. */
const NOTIFICATION_DOMAINS = /(^|\.)(github\.com|gitlab\.com|vercel\.com|render\.com|netlify\.com|heroku\.com|supabase\.(io|com)|sentry\.io|atlassian\.net|slack\.com|linear\.app|notion\.so|google\.com|accounts\.google\.com|facebookmail\.com|linkedin\.com|twitter\.com|x\.com|calendly\.com|zoom\.us|stripe\.com|paypal\.com|intercom-mail\.com|zendesk\.com|docusign\.net|dropbox\.com|apple\.com|microsoft\.com|amazonses\.com)$/i;

/** Hosts that only exist to send bulk mail or track its clicks. */
const ESP_HOSTS = /(^|\.)(mailchimp\.com|mcsv\.net|mcdlv\.net|list-manage\.com|sendgrid\.net|sendinblue\.com|brevo\.com|sibforms\.com|hubspotemail\.net|hs-sites\.com|klaviyomail\.com|klaviyo\.com|mailgun\.org|mandrillapp\.com|constantcontact\.com|campaign-archive\.com|mailerlite\.com|convertkit-mail\d?\.com|substack\.com|beehiiv\.com|customeriomail\.com|exacttarget\.com|sfmc-content\.com|marketo\.com|mktomail\.com|pardot\.com|cmail\d+\.com|createsend\d*\.com|e\.?mailjet\.com|mjt\.lu|ct\.sendgrid\.net|click\.[a-z0-9-]+\.[a-z.]+|links?\.[a-z0-9-]+\.[a-z.]+|email\.[a-z0-9-]+\.[a-z.]+|mc\.[a-z0-9-]+\.[a-z.]+|t\.[a-z0-9-]+\.[a-z.]+)$/i;

const TRANSACTIONAL_SUBJECT = /\b(receipt|invoice|order (confirmation|#|number|summary)|your order|payment (received|confirmation|failed|due)|subscription (renewed|auto-?renewed|will be renewed|confirmation|cancel+ed)|auto-?renewed|renewal (notice|reminder)|upcoming payment|verification code|security code|one-time (code|password)|sign-?in (code|attempt|alert)|password reset|reset your password|confirm your (email|account)|verify your (email|account))\b/i;

/** What a newsletter footer says. Needs two of these, not one. */
const FOOTER_PHRASES: RegExp[] = [
  /\bunsubscribe\b/i,
  /\bmanage (your )?(email )?(preferences|subscription)/i,
  /\bemail preferences\b/i,
  /\bview (this email |it )?in (your |a )?browser\b/i,
  /\byou (are )?receiv(ed|ing) this (email|message) because\b/i,
  /\bthis email was sent (to|by)\b/i,
  /\bupdate your preferences\b/i,
  /\bopt[- ]out\b/i,
  /\ball rights reserved\b/i,
  /\bno longer wish to receive\b/i,
];

function domainOf(email: string): string {
  return (email.split('@')[1] || '').toLowerCase().trim();
}

function linkHosts(html: string | null | undefined): string[] {
  if (!html) return [];
  const hosts: string[] = [];
  const re = /href\s*=\s*["']?https?:\/\/([^/"'\s>?#]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && hosts.length < 200) hosts.push(m[1].toLowerCase());
  return hosts;
}

export function classifyMailKind(input: MailKindInput): MailKindVerdict {
  const from = (input.fromEmail || '').toLowerCase().trim();
  const local = from.split('@')[0] || '';
  const domain = domainOf(from);
  const subject = input.subject || '';
  const h = headerMap(input.headers);

  if (input.own) return { kind: 'internal', reason: 'from one of your own mailboxes' };

  // Somebody you know or have written to is a person, whatever their mail
  // client sets - a prospect replying from Outlook with a list footer
  // bolted on by their company is still a prospect.
  if (input.known) return { kind: 'person', reason: 'a contact, or someone you wrote to' };

  // Receipts and codes come from anywhere; the subject is the tell.
  if (TRANSACTIONAL_SUBJECT.test(subject)) {
    return { kind: 'transactional', reason: 'a receipt, renewal or account notice' };
  }

  if (NOTIFICATION_DOMAINS.test(domain)) return { kind: 'notification', reason: `sent by ${domain}` };

  // Headers that bulk senders set, and people's mail clients never do.
  if (h['list-unsubscribe'] || h['list-id'] || h['list-unsubscribe-post']) {
    return { kind: MACHINE_LOCAL.test(local) && !/news|marketing|promo|digest/.test(local) ? 'notification' : 'bulk', reason: 'mailing-list headers' };
  }
  if (/^(bulk|list|junk)$/i.test(h['precedence'] || '')) return { kind: 'bulk', reason: 'marked as bulk mail' };
  if (h['x-campaign'] || h['x-campaignid'] || h['x-mailchimp-campaign'] || h['x-mc-user'] || h['x-sg-eid'] || h['x-mailgun-tag'] || h['x-sib-id'] || h['x-mailer-lid'] || h['x-hubspot-message-id'] || h['x-marketo-id']) {
    return { kind: 'bulk', reason: 'sent through a marketing platform' };
  }
  if (h['feedback-id'] && /campaign|newsletter|marketing|promo/i.test(h['feedback-id'])) {
    return { kind: 'bulk', reason: 'a campaign feedback id' };
  }

  if (MACHINE_LOCAL.test(local)) return { kind: 'notification', reason: `sent from ${local}@` };

  // Stored mail with no headers: judge the body. A footer is only a footer
  // when it is at the end, and a real reply that quotes your own campaign
  // (which has an unsubscribe link) must not trip it, so quoted history is
  // removed first.
  const text = stripQuoted(input.bodyText || htmlToText(input.bodyHtml || '')).text;
  const tail = text.slice(Math.floor(text.length * 0.5));
  const footerHits = FOOTER_PHRASES.filter((re) => re.test(tail)).length;
  const hosts = linkHosts(input.bodyHtml);
  const espLinks = hosts.filter((host) => ESP_HOSTS.test(host)).length;

  if (footerHits >= 2) return { kind: 'bulk', reason: 'a newsletter footer' };
  if (footerHits >= 1 && (espLinks >= 1 || hosts.length >= 8)) return { kind: 'bulk', reason: 'a footer and tracked links' };
  if (espLinks >= 3) return { kind: 'bulk', reason: 'links through a mailing platform' };
  // A plain-text body that is nothing but tracking URLs.
  const urlCount = (text.match(/https?:\/\/\S+/g) || []).length;
  const words = text.replace(/https?:\/\/\S+/g, ' ').split(/\s+/).filter(Boolean).length;
  if (urlCount >= 3 && words < urlCount * 6) return { kind: 'bulk', reason: 'mostly links' };

  return { kind: 'person', reason: 'written by a person' };
}


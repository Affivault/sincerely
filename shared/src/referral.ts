/* ═══════════════════════════════════════════════════════════════════════
   "Talk to Sam - sam@acme.com."

   A reply that points you at somebody else is one of the warmest leads a
   campaign produces: an introduction, from inside the company. Relay
   noticed ("other", next step naming the person) and nothing happened -
   the address sat in the email for somebody to copy by hand.

   This finds it. An address in the reply's own new text (never the quoted
   history, never the sender's, never one of yours, never a no-reply) that
   sits near words that hand you on: "reach out to", "the best person",
   "copying in", "speak with", "looks after". A name is taken from right
   beside the address when there is one, otherwise from its local part
   when that is a person's ("sam.patel" -> Sam Patel; "partnerships" is
   not).

   Pure: text in, at most a few people out.
   ═══════════════════════════════════════════════════════════════════════ */

import { stripQuoted } from './reply-text.js';

export interface Referral {
  email: string;
  first_name: string | null;
  last_name: string | null;
  /** The sentence it came from, to show beside the offer to act on it. */
  context: string;
}

const HANDOFF = /\b(reach(?:ing)? out to|get in touch with|contact|speak (?:to|with)|talk (?:to|with)|chat (?:to|with)|best person|right person|better person|better placed|person (?:to|you should)|handles?|looks? after|responsible for|in charge of|owns|leads? (?:our|the)|cc['’]?(?:ed|d|ing)?|copy(?:ing)?(?: in)?|copied|loop(?:ing)? in|looped in|forward(?:ed|ing)?|pass(?:ed|ing)? (?:this|it|you) (?:on|along)|introduc(?:e|ing)|email (?:him|her|them)|ping (?:him|her|them)|direct (?:this|your|you))\b/i;

const ROLE = /^(info|hello|hi|contact|sales|support|help|admin|office|team|partners?|partnerships?|marketing|press|media|careers|jobs|hr|finance|billing|accounts?|legal|enquiries|inquiries|noreply|no-reply|donotreply|do-not-reply|mail|mailer|bounce|postmaster|webmaster|biz|bd|business|growth|ops|operations)$/i;

const ADDRESS = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

function title(word: string): string {
  return word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word;
}

/** A person's name from right before the address: "Sam Patel (sam@...)". */
function nameBefore(text: string, at: number): { first: string; last: string | null } | null {
  const before = text.slice(Math.max(0, at - 50), at);
  const m = /([A-Z][a-zA-Z'’-]{1,20})(?:\s+([A-Z][a-zA-Z'’-]{1,25}))?\s*(?:[(<\[]|\bat\b|\bon\b|[-–—:,])?\s*$/.exec(before);
  if (!m) return null;
  const skip = /^(Email|Contact|Reach|Speak|Talk|Ping|Mail|Please|Cc|Hi|Hello|Thanks|At|On|Our|The|He|She|They|Him|Her|Them|I|We)$/;
  if (skip.test(m[1])) return m[2] && !skip.test(m[2]) ? { first: m[2], last: null } : null;
  return { first: m[1], last: m[2] && !skip.test(m[2]) ? m[2] : null };
}

/** A person's name from the address itself, when it is one. */
function nameFromLocal(local: string): { first: string; last: string | null } | null {
  const clean = local.split('+')[0];
  if (ROLE.test(clean)) return null;
  const parts = clean.split(/[._-]+/).filter((p) => /^[a-z]{2,}$/i.test(p));
  if (parts.length === 0 || parts.length > 3) return null;
  if (parts.length === 1) return /^[a-z]{3,12}$/i.test(parts[0]) ? { first: title(parts[0]), last: null } : null;
  return { first: title(parts[0]), last: title(parts[parts.length - 1]) };
}

function sentenceAround(text: string, at: number, end: number): string {
  const startCut = Math.max(text.lastIndexOf('.', at - 1), text.lastIndexOf('\n', at - 1), text.lastIndexOf('!', at - 1), text.lastIndexOf('?', at - 1));
  const rest = text.slice(end);
  const endCut = rest.search(/[.!?\n](\s|$)/);
  return text.slice(startCut + 1, end + (endCut >= 0 ? endCut + 1 : Math.min(rest.length, 80))).replace(/\s+/g, ' ').trim().slice(0, 240);
}

/**
 * The people a reply hands you on to.
 * `ownAddresses` are this account's mailboxes; their domains count as yours.
 */
export function findReferrals(input: {
  body: string;
  senderEmail: string;
  ownAddresses?: string[];
}): Referral[] {
  const fresh = stripQuoted(input.body || '').text;
  // A signature's own addresses are not a hand-off; read up to it.
  const sigCut = fresh.search(/\n\s*(?:--\s*\n|kind regards|best regards|regards,|thanks,|cheers,|sent from my)/i);
  const text = (sigCut > 0 ? fresh.slice(0, sigCut) : fresh).slice(0, 4000);

  const sender = (input.senderEmail || '').trim().toLowerCase();
  const own = new Set((input.ownAddresses || []).map((a) => a.trim().toLowerCase()));
  // A mailbox on a free-mail provider says nothing about who else is "us".
  const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com']);
  const ownDomains = new Set([...own].map((a) => a.split('@')[1]).filter((d): d is string => !!d && !FREE_MAIL.has(d)));

  const out: Referral[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(ADDRESS)) {
    const email = m[0].toLowerCase().replace(/\.$/, '');
    const at = m.index ?? 0;
    const [local, domain] = email.split('@');
    if (!local || !domain || seen.has(email)) continue;
    if (email === sender || own.has(email) || ownDomains.has(domain)) continue;
    if (/^(no-?reply|do-?not-?reply|mailer-daemon|postmaster)$/i.test(local)) continue;

    // The hand-off words, in the same sentence or the one before.
    const near = text.slice(Math.max(0, at - 160), Math.min(text.length, at + email.length + 60));
    if (!HANDOFF.test(near)) continue;

    seen.add(email);
    const name = nameBefore(text, at) || nameFromLocal(local);
    out.push({
      email,
      first_name: name?.first ?? null,
      last_name: name?.last ?? null,
      context: sentenceAround(text, at, at + m[0].length),
    });
    if (out.length >= 3) break;
  }
  return out;
}

/** The intro email, when Claude does not write it. */
export function referralIntro(input: {
  toFirstName: string | null;
  referrerFirstName: string | null;
  referrerCompany: string | null;
  offer?: string | null;
  senderFirstName?: string | null;
}): { subject: string; body: string } {
  const who = input.referrerFirstName || 'Your colleague';
  const offer = (input.offer || '').trim().split(/(?<=[.!?])\s/)[0]?.trim();
  const lines = [
    `Hi ${input.toFirstName || 'there'},`,
    '',
    `${who}${input.referrerCompany ? ` at ${input.referrerCompany}` : ''} suggested I get in touch with you as the right person to talk to.`,
    '',
    offer ? `In short: ${offer.replace(/^[a-z]/, (c) => c.toLowerCase())}` : 'I would like to share a short idea that could be useful for your team.',
    '',
    'Would you be open to a 15-minute call next week?',
  ];
  if (input.senderFirstName) lines.push('', input.senderFirstName);
  return {
    subject: input.referrerFirstName ? `${input.referrerFirstName} suggested I reach out` : 'A quick introduction',
    body: lines.join('\n'),
  };
}

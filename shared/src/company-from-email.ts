/* ═══════════════════════════════════════════════════════════════════════
   Who someone works for, from their address.

   A lead imported with nothing but an email address sat in the table as
   "No title", "—", "—" - even though hello@dodl.co.uk says plainly that
   this is Dodl, at dodl.co.uk. And a newsletter from info@mc.gomarkets.com
   was shown as working at "Mc", because the first label of the domain was
   taken for the company.

   The registrable domain (the part a company actually buys) is found by
   dropping the public suffix and any subdomains in front of it. The name is
   that label, tidied: hyphens become spaces, and each word is capitalised
   unless it is short enough to be an acronym.
   ═══════════════════════════════════════════════════════════════════════ */

import { emailDomain, isFreeMailDomain } from './free-mail.js';

/** Two-label public suffixes that turn up in B2B lead data. */
const TWO_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'ltd.uk', 'plc.uk', 'me.uk', 'net.uk',
  'com.au', 'net.au', 'org.au', 'co.nz', 'org.nz', 'co.za', 'org.za',
  'co.in', 'net.in', 'org.in', 'co.jp', 'ne.jp', 'or.jp', 'co.kr', 'or.kr',
  'com.br', 'net.br', 'org.br', 'com.mx', 'com.ar', 'com.co', 'com.pe', 'com.cl',
  'com.sg', 'com.my', 'com.hk', 'com.tw', 'com.cn', 'net.cn', 'org.cn',
  'com.tr', 'com.ua', 'com.pl', 'com.cy', 'com.mt', 'co.il', 'co.id', 'co.th',
  'com.ph', 'com.vn', 'com.eg', 'com.sa', 'com.ng', 'co.ke',
]);

/** Subdomains mail is sent from, never the company's name. */
const SENDING_LABELS = /^(mail|email|e|em|mc|m|news|newsletter|info|marketing|mkt|send|smtp|bounce|bounces|click|links?|t|go|hello|updates?|notify|notifications?|reply|replies|mailer|lists?|crm|app|www)$/i;

/** example.co.uk from a.b.example.co.uk. Empty for an empty input. */
export function registrableDomain(domain: string | null | undefined): string {
  const d = (domain || '').trim().toLowerCase().replace(/\.$/, '');
  if (!d) return '';
  const labels = d.split('.');
  if (labels.length <= 2) return d;
  const lastTwo = labels.slice(-2).join('.');
  if (TWO_LABEL_SUFFIXES.has(lastTwo)) return labels.slice(-3).join('.');
  return lastTwo;
}

function tidy(label: string): string {
  return label
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    // ii -> II, hl -> HL, ibkr -> IBKR: short or vowel-less labels are
    // initials. Anything else is a word.
    .map((w) => (w.length <= 2 || (w.length <= 4 && !/[aeiouy]/i.test(w)) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/**
 * A readable company name for an address, or null when the address says
 * nothing about an employer (gmail.com, outlook.com...).
 */
export function companyFromEmail(email: string | null | undefined): string | null {
  const domain = emailDomain(email);
  if (!domain || isFreeMailDomain(domain)) return null;
  const reg = registrableDomain(domain);
  const label = reg.split('.')[0];
  if (!label || SENDING_LABELS.test(label)) return null;
  return tidy(label);
}

/** https://example.com for an address at any subdomain of example.com. */
export function websiteFromEmail(email: string | null | undefined): string | null {
  const domain = emailDomain(email);
  if (!domain || isFreeMailDomain(domain)) return null;
  const reg = registrableDomain(domain);
  return reg ? `https://${reg}` : null;
}

/**
 * Shared inboxes rather than a named person: affiliates@, partnerships@,
 * hello@. They are read by whoever is on rota, reply less, and need an
 * opener that doesn't pretend to know one person - worth flagging, not
 * worth excluding.
 */
const ROLE_LOCAL = /^(info|hello|hi|hey|contact|contactus|enquiries|enquiry|inquiries|inquiry|sales|support|help|team|office|admin|affiliates?|affiliation|partners?|partnerships?|partnership|marketing|press|media|pr|careers|jobs|hr|recruitment|billing|accounts|finance|legal|compliance|business|bd|bizdev|growth|ops|operations|general|mail|reception|service|customerservice|cs|feedback|webmaster|introducer|introducers|ib|referrals?)([-_.+]|\d|$)/i;

export function isRoleAddress(email: string | null | undefined): boolean {
  const local = (email || '').split('@')[0]?.trim() || '';
  return !!local && ROLE_LOCAL.test(local);
}

/**
 * A display name worth showing for a sender: the name their mail client
 * sent ("GO Markets"), else the company from the domain, else the local
 * part as typed. "info" on its own tells nobody anything.
 */
export function senderLabel(email: string | null | undefined, displayName?: string | null): string {
  const name = (displayName || '').replace(/^["']|["']$/g, '').trim();
  if (name && !name.includes('@')) return name;
  const company = companyFromEmail(email);
  const local = (email || '').split('@')[0] || '';
  if (company && (isRoleAddress(email) || /^(no-?reply|notifications?|news|alerts?)/i.test(local))) return company;
  return local || email || '';
}

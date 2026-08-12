/* ═══════════════════════════════════════════════════════════════════════
   Consumer mailbox providers.

   The per-domain throttle exists so a campaign doesn't drop thirty emails
   into one company inside a minute — the pattern a recipient's gateway
   reads as an attack on that organisation. That reasoning depends on the
   domain *being* an organisation.

   gmail.com is not an organisation. Nor is outlook.com, or any of the
   others below: they are millions of unrelated people who happen to share
   a mail provider, and the receiving gateway knows that perfectly well.
   Throttling them as if they were one company would mean a campaign aimed
   at freelancers and one-person businesses — a large slice of who gets
   cold-emailed — grinding to five sends an hour for no benefit at all.

   So these are exempt. The list only needs the providers that actually
   turn up in B2B lead data; anything missing is throttled, which is the
   safe direction to be wrong in.
   ═══════════════════════════════════════════════════════════════════════ */

const FREE_MAIL_DOMAINS = new Set([
  // Google
  'gmail.com', 'googlemail.com',
  // Microsoft
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'passport.com',
  'outlook.co.uk', 'hotmail.co.uk', 'live.co.uk', 'hotmail.fr', 'outlook.fr',
  'hotmail.de', 'outlook.de', 'hotmail.it', 'hotmail.es', 'live.nl', 'live.ca',
  'hotmail.ca', 'live.com.au', 'hotmail.com.au',
  // Yahoo and friends
  'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in', 'yahoo.fr', 'yahoo.de',
  'yahoo.it', 'yahoo.es', 'yahoo.ca', 'yahoo.com.au', 'yahoo.com.br',
  'ymail.com', 'rocketmail.com',
  // AOL
  'aol.com', 'aim.com',
  // Apple
  'icloud.com', 'me.com', 'mac.com',
  // Privacy-focused
  'proton.me', 'protonmail.com', 'pm.me', 'tutanota.com', 'tuta.io',
  'hushmail.com', 'fastmail.com', 'fastmail.fm',
  // Regional, common in European and Asian lead data
  'gmx.com', 'gmx.de', 'gmx.net', 'gmx.at', 'gmx.ch',
  'web.de', 't-online.de', 'freenet.de', 'arcor.de',
  'orange.fr', 'wanadoo.fr', 'free.fr', 'laposte.net', 'sfr.fr',
  'libero.it', 'virgilio.it', 'alice.it', 'tin.it',
  'terra.com.br', 'uol.com.br', 'bol.com.br',
  'mail.ru', 'yandex.ru', 'yandex.com', 'bk.ru', 'inbox.ru', 'list.ru',
  'qq.com', '163.com', '126.com', 'sina.com', 'sohu.com',
  'naver.com', 'daum.net', 'hanmail.net',
  'rediffmail.com',
  'seznam.cz', 'wp.pl', 'o2.pl', 'interia.pl', 'onet.pl',
  'bigpond.com', 'optusnet.com.au', 'xtra.co.nz',
  'telus.net', 'shaw.ca', 'sympatico.ca', 'rogers.com',
  'btinternet.com', 'virginmedia.com', 'sky.com', 'talktalk.net',
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'cox.net',
  'charter.net', 'earthlink.net', 'juno.com', 'bellsouth.net',
  // Disposable — worth exempting for the same reason, and worth knowing about
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'yopmail.com',
  'temp-mail.org', 'throwawaymail.com', 'trashmail.com',
]);

/** The domain part of an address, lowercased. Empty when there isn't one. */
export function emailDomain(email: string | null | undefined): string {
  if (!email || typeof email !== 'string') return '';
  const at = email.lastIndexOf('@');
  if (at === -1) return '';
  return email.slice(at + 1).trim().toLowerCase();
}

/**
 * Is this a consumer mailbox provider rather than an organisation?
 *
 * Used to decide whether a domain is worth throttling as a unit. Being wrong
 * in the "no" direction just means an unnecessary throttle; being wrong in
 * the "yes" direction means no protection at all — so anything unrecognised
 * is treated as a company.
 */
export function isFreeMailDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  return FREE_MAIL_DOMAINS.has(domain.trim().toLowerCase());
}

/** Convenience: does this address belong to a consumer provider? */
export function isFreeMailAddress(email: string | null | undefined): boolean {
  return isFreeMailDomain(emailDomain(email));
}

/** Exposed for tests and for anything that wants to show the exemption list. */
export function freeMailDomains(): string[] {
  return [...FREE_MAIL_DOMAINS].sort();
}

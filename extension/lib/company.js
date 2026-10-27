/**
 * Which company the page in front of the user is about.
 *
 * The sidebar's "People at" panel needs one answer, a company name and
 * ideally its domain, from very different pages: a company's own website, its
 * LinkedIn page, a LinkedIn profile of somebody who works there, or an email
 * from them. Pure functions, so they can be tested without a browser.
 */

/** Second-level suffixes under which a company's domain has three labels. */
const SECOND_LEVEL = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'ltd.uk', 'plc.uk', 'me.uk',
  'com.au', 'net.au', 'org.au', 'co.nz', 'org.nz', 'co.za', 'co.jp', 'ne.jp',
  'com.br', 'com.mx', 'com.ar', 'com.sg', 'com.my', 'com.hk', 'com.tr',
  'co.in', 'co.kr', 'co.il', 'com.cn', 'com.tw', 'com.pl', 'com.es',
]);

/** Sites that are nobody's company website, whatever their domain says. */
const NOT_A_COMPANY = new Set([
  'google.com', 'bing.com', 'duckduckgo.com', 'yahoo.com', 'facebook.com',
  'instagram.com', 'twitter.com', 'x.com', 'youtube.com', 'reddit.com',
  'wikipedia.org', 'tiktok.com', 'pinterest.com', 'medium.com',
  'chromewebstore.google.com', 'mail.google.com', 'linkedin.com',
]);

/** Addresses at these say nothing about where somebody works. */
const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
  'msn.com', 'yahoo.com', 'ymail.com', 'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.de', 'web.de',
  'mail.com', 'zoho.com', 'yandex.com', 'yandex.ru', 'hotmail.co.uk',
  'yahoo.co.uk', 'btinternet.com', 'orange.fr', 'free.fr', 'qq.com', '163.com',
]);

/**
 * The domain a company registered, from any host under it:
 * careers.eu.acme.co.uk becomes acme.co.uk.
 *
 * @param {string} host
 * @returns {string|null}
 */
export function registrableDomain(host) {
  const clean = String(host || '').trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (!clean || !clean.includes('.')) return null;
  // An IP address is a machine, not a company.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(clean) || clean.includes(':')) return null;
  const labels = clean.split('.');
  const lastTwo = labels.slice(-2).join('.');
  const take = SECOND_LEVEL.has(lastTwo) ? 3 : 2;
  return labels.length >= take ? labels.slice(-take).join('.') : null;
}

/** @param {string} domain */
export function isFreeMail(domain) {
  return FREE_MAIL.has(String(domain || '').toLowerCase());
}

/**
 * A readable name for a company known only by its domain: acme-labs.co.uk
 * becomes "Acme Labs". Shown, never searched on.
 *
 * @param {string} domain
 */
export function nameFromDomain(domain) {
  const base = String(domain || '').split('.')[0] || '';
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * @typedef {{name: string, domain: string|null, linkedin_url: string|null,
 *   kind: 'site'|'linkedin-company'|'colleagues'}} CompanyTarget
 */

/**
 * The company to offer "People at" for, or null when the page is about none.
 *
 * @param {{person?: object|null, tabUrl?: string, appUrl?: string}} context
 * @returns {CompanyTarget|null}
 */
export function companyTarget({ person = null, tabUrl = '', appUrl = '' } = {}) {
  let url;
  try {
    url = new URL(tabUrl);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;

  // Never the app itself: those are the user's own pages.
  try {
    if (appUrl && new URL(appUrl).hostname === url.hostname) return null;
  } catch {
    // An unparseable app URL just means there is nothing to exclude.
  }
  if (/^(localhost|127\.0\.0\.1)$/.test(url.hostname)) return null;

  // A LinkedIn company page says exactly which company it is.
  if (person?.company_page?.name) {
    return {
      name: person.company_page.name,
      domain: person.company_page.domain || null,
      linkedin_url: person.company_page.linkedin_url || null,
      kind: 'linkedin-company',
    };
  }

  const onLinkedIn = /(^|\.)linkedin\.com$/i.test(url.hostname);
  const onGmail = url.hostname === 'mail.google.com';

  // A profile or an email: the company they work at, so the rest of it.
  if (onLinkedIn || onGmail) {
    const fromEmail = String(person?.email || '').split('@')[1] || '';
    const emailDomain = fromEmail && !isFreeMail(fromEmail) ? registrableDomain(fromEmail) : null;
    const domain = person?.company_domain ? registrableDomain(person.company_domain) : emailDomain;
    const name = String(person?.company || '').trim() || (domain ? nameFromDomain(domain) : '');
    if (!name && !domain) return null;
    return { name: name || domain, domain: domain || null, linkedin_url: null, kind: 'colleagues' };
  }

  // Anywhere else, the site itself is the company.
  const domain = registrableDomain(url.hostname);
  if (!domain || NOT_A_COMPANY.has(domain) || NOT_A_COMPANY.has(url.hostname.replace(/^www\./, ''))) return null;
  const siteName = String(person?.company || '').trim();
  // og:site_name is often a whole tagline; a short one is a name.
  const name = siteName && siteName.length <= 40 ? siteName : nameFromDomain(domain);
  return { name, domain, linkedin_url: null, kind: 'site' };
}

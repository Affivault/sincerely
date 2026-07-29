/**
 * Email harvesting from a website's own public pages.
 *
 * This is the part that costs nothing to run. Every paid enrichment product
 * charges because it licenses a people database; reading a company's own
 * /contact page is just an HTTP request, so the whole flow is free — it needs
 * no provider, no credits, and no server work. The extension fetches the pages
 * itself from the service worker.
 *
 * Pure functions, deliberately: the parsing is the part most likely to be
 * wrong, and keeping it free of fetch and chrome APIs means it can be tested
 * directly.
 *
 * Service workers have no DOMParser, so everything here works on raw HTML text.
 */

/** Matches an address, permissively — filtering happens afterwards. */
const EMAIL = /[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** Role accounts. Kept, but ranked below a named person. */
const ROLE_LOCAL = /^(no-?reply|do-?not-?reply|postmaster|mailer-daemon|abuse|privacy|legal|jobs|careers|press|marketing|newsletter|unsubscribe|bounce|webmaster|notifications?)$/i;

/** Generic-but-useful inboxes: worth keeping, worth flagging. */
const GENERIC_LOCAL = /^(info|hello|hi|contact|enquiries|inquiries|sales|support|admin|office|team|mail)$/i;

/** Never a person: asset pipelines, tracking, and image filenames. */
const NOISE_DOMAIN = /^(?:[a-z0-9-]+\.)*(gstatic|googletagmanager|doubleclick|google-analytics|sentry|cloudflareinsights|w3|sentry-cdn|wixpress|squarespace|shopify)\.(com|io|net|org)$/i;
const ASSET_EXTENSION = /\.(png|jpe?g|gif|svg|webp|css|js|woff2?|ico|mp4|pdf)$/i;

/**
 * Paths worth trying on any site, in rough order of how often they carry
 * addresses. Includes the European ones — an Impressum is legally required in
 * Germany and Austria and almost always lists a real address.
 */
export const CANDIDATE_PATHS = [
  '/',
  '/contact',
  '/contact-us',
  '/contacts',
  '/about',
  '/about-us',
  '/team',
  '/our-team',
  '/people',
  '/staff',
  '/leadership',
  '/company',
  '/impressum',
  '/imprint',
  '/legal-notice',
];

/** Links on a page that look like they lead somewhere with addresses. */
const PROMISING_LINK = /(contact|about|team|people|staff|leadership|impressum|imprint|kontakt|nous-contacter|equipe)/i;

/* ------------------------------------------------------------------ */
/* Deobfuscation                                                      */
/* ------------------------------------------------------------------ */

/**
 * Decode Cloudflare's email protection.
 *
 * Cloudflare rewrites addresses to <a class="__cf_email__" data-cfemail="HEX">
 * and reassembles them in the browser, which is why a naive scraper finds
 * nothing on a large slice of the web. The first byte of the hex is an XOR key
 * for the rest.
 *
 * @param {string} hex
 * @returns {string|null}
 */
export function decodeCfEmail(hex) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 4 || hex.length % 2 !== 0) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < hex.length; i += 2) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  }
  return EMAIL.test(out) ? ((EMAIL.lastIndex = 0), out.toLowerCase()) : null;
}

/**
 * Undo the hand-rolled obfuscations sites use to dodge scrapers:
 * "name (at) example (dot) com", "name AT example DOT com", HTML entities,
 * and zero-width characters sprinkled through the address.
 *
 * @param {string} html
 * @returns {string}
 */
export function deobfuscate(html) {
  return (
    html
      // Numeric and named entities for @ and .
      .replace(/&#0*64;|&commat;|&#x0*40;/gi, '@')
      .replace(/&#0*46;|&period;|&#x0*2e;/gi, '.')
      .replace(/&amp;/gi, '&')
      // Zero-width and soft-hyphen padding inside addresses.
      .replace(/[​-‍﻿­]/g, '')
      // " at " / " dot " spelled out, bracketed or parenthesised.
      .replace(/\s*[[({<]\s*(at|@)\s*[\])}>]\s*/gi, '@')
      .replace(/\s*[[({<]\s*(dot|\.)\s*[\])}>]\s*/gi, '.')
      .replace(/\s+\bat\b\s+/gi, '@')
      .replace(/\s+\bdot\b\s+/gi, '.')
  );
}

/* ------------------------------------------------------------------ */
/* Extraction                                                         */
/* ------------------------------------------------------------------ */

/** @param {string} email */
export function classifyEmail(email) {
  const [local, domain] = String(email).toLowerCase().split('@');
  if (!local || !domain) return null;
  if (ASSET_EXTENSION.test(email)) return null;
  if (NOISE_DOMAIN.test(domain)) return null;
  // Hex-looking locals are almost always tracking ids, not people.
  if (/^[0-9a-f]{16,}$/i.test(local)) return null;
  if (email.length > 254) return null;

  if (ROLE_LOCAL.test(local)) return 'role';
  if (GENERIC_LOCAL.test(local)) return 'generic';
  return 'person';
}

/**
 * Capitalised words that turn up next to addresses on team pages but are job
 * titles, company suffixes or page furniture rather than names. Without this,
 * "Managing Partner" and "Sales Director" get filed as people.
 */
const NOT_A_NAME =
  /^(head|chief|managing|senior|junior|vice|president|director|officer|partner|manager|lead|founder|co|owner|associate|analyst|executive|consultant|specialist|coordinator|assistant|sales|marketing|trading|growth|operations|finance|legal|product|engineering|support|team|our|contact|email|phone|address|about|company|group|capital|holdings|limited|ltd|inc|llc|plc|gmbh|the|and|for|with|new|read|more|view|learn|get|call|book)$/i;

/**
 * Try to name the person an address belongs to.
 *
 * The local part is tried first because it's the stronger signal:
 * "jane.doe@" is unambiguous, where nearby text is guesswork. Text is the
 * fallback for addresses like "cara@" that carry no surname, which is exactly
 * the case a team page can answer.
 *
 * @param {string} email
 * @param {string} context Plain text preceding the address.
 * @returns {{first_name: string|null, last_name: string|null}}
 */
export function nameFor(email, context = '') {
  const local = String(email).split('@')[0].toLowerCase();
  const parts = local.split(/[._-]+/).filter((p) => p.length > 1 && /^[a-z]+$/.test(p));
  if (parts.length >= 2 && !NOT_A_NAME.test(parts[0])) {
    return { first_name: capitalise(parts[0]), last_name: capitalise(parts[1]) };
  }

  // Last "Firstname Lastname" before the address. Last, not first, because a
  // team page lists many people and the nearest one owns this address; and a
  // job title may sit between the two ("Jane Doe, Head of Trading — jane@…"),
  // so the pair need not be adjacent to the address itself.
  const before = context.slice(-160);
  let candidate = null;
  for (const match of before.matchAll(/\b([A-Z][a-z'’-]{1,20})\s+([A-Z][a-z'’-]{1,20})\b/g)) {
    if (NOT_A_NAME.test(match[1]) || NOT_A_NAME.test(match[2])) continue;
    candidate = { first_name: match[1], last_name: match[2] };
  }
  if (candidate) return candidate;

  return { first_name: null, last_name: null };
}

function capitalise(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Every address in one page of HTML, with what we could work out about each.
 *
 * @param {string} html
 * @param {string} pageUrl Where this HTML came from, for attribution.
 * @returns {Array<{email: string, kind: string, first_name: string|null, last_name: string|null, source_url: string}>}
 */
export function extractFromHtml(html, pageUrl) {
  const found = new Map();

  const add = (rawEmail, context) => {
    const email = String(rawEmail).toLowerCase().replace(/[.,;:'")\]]+$/, '');
    const kind = classifyEmail(email);
    if (!kind || found.has(email)) return;
    found.set(email, { email, kind, ...nameFor(email, context), source_url: pageUrl });
  };

  // 1. Cloudflare-protected addresses, which a plain regex never sees.
  for (const match of html.matchAll(/data-cfemail=["']([0-9a-fA-F]+)["']/g)) {
    const decoded = decodeCfEmail(match[1]);
    if (decoded) add(decoded, html.slice(Math.max(0, match.index - 200), match.index));
  }

  // 2. mailto: links — the most reliable signal on any page.
  for (const match of html.matchAll(/href=["']mailto:([^"'?]+)/gi)) {
    add(decodeURIComponent(match[1]), html.slice(Math.max(0, match.index - 200), match.index));
  }

  // 3. Body text, after undoing the usual obfuscations. Tags are stripped so
  //    markup between the name and the address doesn't ruin attribution.
  const text = deobfuscate(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

  EMAIL.lastIndex = 0;
  for (const match of text.matchAll(EMAIL)) {
    add(match[0], text.slice(Math.max(0, match.index - 160), match.index));
  }

  return [...found.values()];
}

/**
 * Same-origin links from a page that are worth following.
 *
 * @param {string} html
 * @param {string} baseUrl
 * @param {number} limit
 * @returns {string[]} Absolute URLs.
 */
export function promisingLinks(html, baseUrl, limit = 10) {
  const base = new URL(baseUrl);
  const seen = new Set();
  const out = [];

  for (const match of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    if (out.length >= limit) break;
    const href = match[1];
    if (/^(mailto:|tel:|javascript:|data:)/i.test(href)) continue;

    let url;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    // Same site only: following outbound links would turn a scan of one
    // company into a crawl of the web.
    if (url.origin !== base.origin) continue;
    if (ASSET_EXTENSION.test(url.pathname)) continue;
    if (!PROMISING_LINK.test(url.pathname)) continue;

    url.hash = '';
    const key = url.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }

  return out;
}

/**
 * Order results the way a human would want to act on them: named people
 * first, then shared inboxes, then role accounts.
 *
 * @param {Array<{kind: string, email: string, first_name: string|null}>} results
 */
export function rankResults(results) {
  const weight = { person: 0, generic: 1, role: 2 };
  return [...results].sort((a, b) => {
    const byKind = (weight[a.kind] ?? 3) - (weight[b.kind] ?? 3);
    if (byKind !== 0) return byKind;
    // A named address is more useful than an unnamed one of the same kind.
    const named = Number(Boolean(b.first_name)) - Number(Boolean(a.first_name));
    if (named !== 0) return named;
    return a.email.localeCompare(b.email);
  });
}

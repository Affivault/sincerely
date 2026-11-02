/* ═══════════════════════════════════════════════════════════════════════
   Finding emails for imported rows that arrived without one.

   Lead tools export plenty of people with a name, a company and a LinkedIn
   profile but no address - the address was a paid unlock in the other tool.
   Those rows used to be set aside as "no email". Now the import offers to
   find them, cheapest source first:

     1. FREE - the account's own convention for that domain plus the mail
        server (email-finder.service). Accepted only when it is more than a
        guess: confirmed by the server, or following a convention the
        account's other contacts at that domain already use.
     2. PAID - the data provider's email search (Icypeas today), at the
        same price as a reveal in the prospector, and refunded when nothing
        is found. Only when a provider is configured, and never after the
        account runs out of credits.

   Nothing is guessed into the contact list: a person with no confident
   address stays in the "not imported" download, with the reason.
   ═══════════════════════════════════════════════════════════════════════ */

import { CREDIT_PRICES, normalizeLinkedinUrl } from '@lemlist/shared';
import { findEmail, normaliseDomain } from './email-finder.service.js';
import { getActiveProvider } from './prospect-providers.js';
import { creditsService, OutOfCreditsError } from './credits.service.js';
import { withUsage } from './provider-usage.service.js';

export interface ImportFindInput {
  /** The client's row key, echoed back. */
  key: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  company?: string;
  /** A company website or bare domain. */
  domain?: string;
  linkedin_url?: string;
}

export interface ImportFindResult {
  key: string;
  email: string | null;
  /** 'pattern' = found free; 'provider' = paid search (charged). */
  via: 'pattern' | 'provider' | null;
  reason: string | null;
}

/** Enough to search with: a name, and a company or its domain. */
export function searchable(p: ImportFindInput): boolean {
  const hasName = !!(p.first_name?.trim() || p.last_name?.trim() || p.full_name?.trim());
  return hasName && !!(p.domain?.trim() || p.company?.trim());
}

function names(p: ImportFindInput): { first: string; last: string } {
  let first = (p.first_name || '').trim();
  let last = (p.last_name || '').trim();
  if ((!first || !last) && p.full_name) {
    const parts = p.full_name.trim().split(/\s+/);
    if (!first) first = parts[0] || '';
    if (!last) last = parts.slice(1).join(' ');
  }
  return { first, last };
}

/**
 * Only a provider whose email search works from a name and a company can
 * search for an imported row: the others look people up by their own ids,
 * which a CSV from another tool does not have.
 */
function nameSearchProvider() {
  const p = getActiveProvider();
  return p && p.id === 'icypeas' ? p : null;
}

export const importEmailFinder = {
  /** Can a paid search run at all here, and what does one cost? */
  paidAvailable(): { available: boolean; price: number } {
    return { available: !!nameSearchProvider(), price: CREDIT_PRICES.reveal };
  },

  async find(userId: string, people: ImportFindInput[], allowPaid: boolean): Promise<{ results: ImportFindResult[]; out_of_credits: boolean }> {
    const provider = allowPaid ? nameSearchProvider() : null;
    let outOfCredits = false;

    const one = async (p: ImportFindInput): Promise<ImportFindResult> => {
      const key = String(p.key);
      if (!searchable(p)) return { key, email: null, via: null, reason: 'Needs a name and a company to search' };
      const { first, last } = names(p);
      const domain = normaliseDomain(p.domain || '');

      // 1. Free.
      if (domain) {
        try {
          const r = await findEmail(userId, { first_name: first, last_name: last, domain });
          if (r.found && r.email && (r.verified || r.pattern_from_known || r.confidence >= 70)) {
            return { key, email: r.email.toLowerCase(), via: 'pattern', reason: null };
          }
        } catch { /* fall through to the paid search */ }
      }

      // 2. Paid, charged only when something is found.
      if (!provider || outOfCredits) {
        return { key, email: null, via: null, reason: outOfCredits ? 'Out of credits' : 'Not found' };
      }
      const spend = { amount: CREDIT_PRICES.reveal, action: 'reveal', provider: provider.id, ref: `import:${normalizeLinkedinUrl(p.linkedin_url || '') || `${first} ${last} @ ${domain || p.company}`}`.slice(0, 200) };
      let bucket: string;
      try {
        bucket = await creditsService.spend(userId, spend);
      } catch (e) {
        if (e instanceof OutOfCreditsError) { outOfCredits = true; return { key, email: null, via: null, reason: 'Out of credits' }; }
        return { key, email: null, via: null, reason: 'Could not charge credits' };
      }
      try {
        const res = await withUsage(userId, 'reveal', () => provider.enrichEmail(`import:${key}:${Date.now()}`, {
          first_name: first || null,
          last_name: last || null,
          company: p.company || null,
          company_domain: domain || null,
          linkedin_url: p.linkedin_url || null,
        }));
        const email = res.email ? String(res.email).trim().toLowerCase() : null;
        if (!email) {
          await creditsService.refund(userId, { ...spend, reason: 'no_email_found', bucket });
          return { key, email: null, via: null, reason: 'Not found' };
        }
        return { key, email, via: 'provider', reason: null };
      } catch {
        await creditsService.refund(userId, { ...spend, reason: 'provider_error', bucket });
        return { key, email: null, via: null, reason: 'The data provider did not answer' };
      }
    };

    // A few at a time: each paid search polls for up to ~30 seconds.
    const results: ImportFindResult[] = new Array(people.length);
    let next = 0;
    const worker = async () => {
      while (next < people.length) {
        const i = next++;
        results[i] = await one(people[i]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, people.length) }, worker));
    return { results, out_of_credits: outOfCredits };
  },
};

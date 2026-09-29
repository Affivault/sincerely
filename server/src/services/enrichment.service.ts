/* ═══════════════════════════════════════════════════════════════════════
   Leads that fill themselves in.

   A lead imported with nothing but an address showed "No title", "—", "—"
   across the table, even though the address says who they work for and
   where the company lives on the web. This fills what the address can
   honestly tell you, and nothing it can't:

     company     from the domain, when the field is empty
     website     https://<registrable domain>, when empty
     company_id  linked to (or creates) the company record for that domain
     is_role_address   hello@, partnerships@ - a shared inbox, not a person

   It never overwrites anything a person or an import set. It runs in the
   background after contacts are added, and once over everything already
   there the first time the list is opened.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { companyFromEmail, websiteFromEmail, isRoleAddress, registrableDomain, emailDomain, isFreeMailDomain } from '@lemlist/shared';
import { companiesService } from './companies.service.js';

const running = new Set<string>();
const again = new Set<string>();
const PAGE = 300;

/**
 * Names already written for each domain - on a company record, or on
 * another lead there. "InvestEngine" typed once beats "Investengine" guessed
 * from the domain every time after.
 */
async function knownNames(userId: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const { data: companies } = await supabaseAdmin
    .from('companies').select('name, domain').eq('user_id', userId).not('domain', 'is', null).limit(5000);
  for (const c of companies || []) {
    const d = registrableDomain(String((c as any).domain || '').replace(/^https?:\/\//, '').split('/')[0]);
    if (d && !isFreeMailDomain(d) && (c as any).name && !names.has(d)) names.set(d, (c as any).name);
  }
  const counts = new Map<string, Map<string, number>>();
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('contacts').select('email, company').eq('user_id', userId).not('company', 'is', null).range(from, from + 999);
    if (error || !data?.length) break;
    for (const r of data as any[]) {
      const d = registrableDomain(emailDomain(r.email));
      const name = String(r.company || '').trim();
      // gmail.com is millions of people, not one employer.
      if (!d || !name || isFreeMailDomain(d)) continue;
      const m = counts.get(d) || new Map<string, number>();
      m.set(name, (m.get(name) || 0) + 1);
      counts.set(d, m);
    }
    if (data.length < 1000) break;
  }
  for (const [d, m] of counts) {
    if (names.has(d)) continue;
    const best = [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (best) names.set(d, best);
  }
  return names;
}

async function enrichAll(userId: string): Promise<number> {
  let done = 0;
  let known: Map<string, string> | null = null;
  for (let guard = 0; guard < 100; guard++) {
    const { data: rows, error } = await supabaseAdmin
      .from('contacts')
      .select('id, email, company, website, company_id')
      .eq('user_id', userId)
      .is('enriched_at', null)
      .limit(PAGE);
    // Column missing = migration 076 not run yet.
    if (error || !rows?.length) return done;

    const now = new Date().toISOString();
    const toLink = new Map<string, { name: string; domain: string; website: string | null; ids: string[] }>();

    if (!known) known = await knownNames(userId);
    for (const c of rows as any[]) {
      const patch: Record<string, any> = { enriched_at: now, is_role_address: isRoleAddress(c.email) };
      const derived = (known.get(registrableDomain(emailDomain(c.email))) || null) ?? companyFromEmail(c.email);
      const company = (c.company && String(c.company).trim()) || derived;
      if (!c.company && derived) patch.company = derived;
      if (!c.website) {
        const site = websiteFromEmail(c.email);
        if (site) patch.website = site;
      }
      const { error: upErr } = await supabaseAdmin.from('contacts').update(patch).eq('id', c.id).eq('user_id', userId);
      // A row that will not save would be re-read on every pass; stop instead.
      if (upErr) return done;

      // Link to the company record for their domain, when they have none.
      const domain = registrableDomain(emailDomain(c.email));
      if (!c.company_id && company && domain && derived) {
        const key = `${company.toLowerCase()}|${domain}`;
        const entry = toLink.get(key) || { name: company, domain, website: websiteFromEmail(c.email), ids: [] as string[] };
        entry.ids.push(c.id);
        toLink.set(key, entry);
      }
      done++;
    }

    for (const entry of toLink.values()) {
      try {
        const co: any = await companiesService.createOrGet(userId, { name: entry.name, domain: entry.domain, website: entry.website });
        if (co?.id) {
          // Fill the company's own blanks too - never its edits.
          if (!co.domain || !co.website) {
            await supabaseAdmin.from('companies')
              .update({ ...(co.domain ? {} : { domain: entry.domain }), ...(co.website ? {} : { website: entry.website }) })
              .eq('id', co.id).eq('user_id', userId);
          }
          await supabaseAdmin.from('contacts').update({ company_id: co.id })
            .eq('user_id', userId).in('id', entry.ids).is('company_id', null);
        }
      } catch { /* a company that can't be made is not worth failing the rest */ }
    }
    if (rows.length < PAGE) return done;
  }
  return done;
}

export const enrichmentService = {
  /** Fill in whatever is unfilled, in the background. Safe to call often. */
  ensure(userId: string): void {
    if (running.has(userId)) { again.add(userId); return; }
    running.add(userId);
    const run = (): Promise<void> => enrichAll(userId)
      .then(() => {
        if (again.delete(userId)) return run();
      })
      .catch((e) => console.warn('[Enrichment]', userId, e?.message || e));
    run().finally(() => running.delete(userId));
  },
};

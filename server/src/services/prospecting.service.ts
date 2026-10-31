import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { creditsService } from './credits.service.js';
import { withUsage } from './provider-usage.service.js';
import { listsService } from './lists.service.js';
import { getActiveProvider, icypeasCompanyPagesToFetch, icypeasCompanyQuery, icypeasCompanySearch } from './prospect-providers.js';
import { companyDirectoryService } from './company-directory.service.js';
import { CREDIT_PRICES, normalizeLinkedinUrl, describeProspectSearch, rankProspects } from '@lemlist/shared';
import { campaignContactsService } from './campaign-contacts.service.js';
import type {
  CompanySearchFilters,
  CompanySearchResponse,
  ProspectDestination,
  ProspectPerson,
  ProspectSearchFilters,
  ProspectSearchResponse,
  ProspectorStatus,
  RevealProspectInput,
  RevealProspectResponse,
} from '@lemlist/shared';

/**
 * Emails discovered at search time (some providers include them) are held
 * server-side only, so a reveal can reuse them without a second provider
 * call. Never sent to the client — revealing always goes through credits.
 */
const searchEmailCache = new Map<string, { email: string; at: number }>();
const CACHE_TTL_MS = 15 * 60 * 1000;

function cacheKey(userId: string, provider: string, personId: string) {
  return `${userId}:${provider}:${personId}`;
}
function pruneCache() {
  const cutoff = Date.now() - CACHE_TTL_MS;
  for (const [k, v] of searchEmailCache) {
    if (v.at < cutoff) searchEmailCache.delete(k);
  }
}

export const prospectingService = {
  async status(userId: string): Promise<ProspectorStatus> {
    const provider = getActiveProvider();
    const [credits, company_directory] = await Promise.all([
      creditsService.summary(userId),
      companyDirectoryService.status(),
    ]);
    return { provider: provider?.id ?? null, credits, company_directory };
  },

  /** How many people the filters match, free: shown live while filters change. */
  async count(filters: ProspectSearchFilters): Promise<{ total: number | null }> {
    const provider = getActiveProvider();
    if (!provider?.count) return { total: null };
    try {
      return { total: await provider.count(filters || {}) };
    } catch (err) {
      // A count is a hint: a rate limit or a rejected filter must not break the panel.
      console.warn('[prospecting] count failed:', (err as Error).message);
      return { total: null };
    }
  },

  async search(userId: string, filters: ProspectSearchFilters, page = 1): Promise<ProspectSearchResponse> {
    const provider = getActiveProvider();
    if (!provider) {
      throw new AppError('No prospect data provider is configured. Add an ICYPEAS_API_KEY (or PDL_API_KEY) to enable the prospector.', 503);
    }
    const perPage = 25;
    const safePage = Math.min(Math.max(1, Number(page) || 1), 40);

    /*
     * A page costs credits only when the provider is paid for it: one held
     * from the last few minutes is free, and a jump that walks forward pays
     * for each page it walks. Charged up front, so an account without the
     * credits never makes the paid call; refunded if the call fails or
     * comes back empty (Icypeas bills per result, so an empty page is free).
     */
    const pages = provider.pagesToFetch ? provider.pagesToFetch(filters || {}, safePage, perPage) : 1;
    const charge = Math.round(pages * CREDIT_PRICES.search * 10) / 10;
    const spend = { amount: charge, action: 'search', provider: provider.id, ref: `page ${safePage}` };
    const bucket = charge > 0 ? await creditsService.spend(userId, spend) : null;
    let found;
    try {
      found = await withUsage(userId, 'search', () => provider.search(filters, safePage, perPage));
    } catch (err) {
      if (bucket) await creditsService.refund(userId, { ...spend, reason: 'provider_error', bucket });
      throw err;
    }
    const { results, total, emailsById } = found;
    if (bucket && results.length === 0) await creditsService.refund(userId, { ...spend, reason: 'no_results', bucket });

    // Stash search-time emails for the reveal step; strip them from the payload.
    pruneCache();
    for (const [id, email] of emailsById) {
      searchEmailCache.set(cacheKey(userId, provider.id, id), { email, at: Date.now() });
    }

    // Mark people this user already revealed so the UI can show them unlocked.
    if (results.length > 0) {
      const { data: reveals } = await supabaseAdmin
        .from('prospect_reveals')
        .select('provider_person_id, contact_id, email')
        .eq('user_id', userId)
        .eq('provider', provider.id)
        .in('provider_person_id', results.map((r) => r.id));
      const byId = new Map((reveals || []).map((r: any) => [r.provider_person_id, r]));
      for (const person of results) {
        const seen = byId.get(person.id);
        if (seen) {
          person.already_revealed = true;
          person.contact_id = seen.contact_id;
        }
      }
    }

    // Best fits first within the page; the provider has already done the filtering.
    return { results: rankProspects(results, filters || {}), page: safePage, total, provider: provider.id };
  },

  /**
   * Icypeas's company database, priced like a people search: each new page
   * of 25 costs CREDIT_PRICES.search, refunded when it fails or is empty.
   */
  async searchCompanies(userId: string, filters: CompanySearchFilters, page: number): Promise<CompanySearchResponse> {
    // Checked before charging: an empty search used to spend, fail and refund,
    // and an account with no credits left was told it was out of credits
    // instead of being asked for a filter.
    if (!Object.keys(icypeasCompanyQuery(filters || {})).length) {
      throw new AppError('Add at least one filter to search companies.', 400);
    }
    const pages = icypeasCompanyPagesToFetch(filters || {}, page);
    const charge = Math.round(pages * CREDIT_PRICES.search * 10) / 10;
    const spend = { amount: charge, action: 'search', provider: 'icypeas', ref: `companies page ${page}` };
    const bucket = charge > 0 ? await creditsService.spend(userId, spend) : null;
    try {
      const res = await withUsage(userId, 'search', () => icypeasCompanySearch(filters || {}, page));
      if (bucket && res.results.length === 0) await creditsService.refund(userId, { ...spend, reason: 'no_results', bucket });
      return res;
    } catch (err) {
      if (bucket) await creditsService.refund(userId, { ...spend, reason: 'provider_error', bucket });
      throw err;
    }
  },

  /**
   * `enrolListCampaigns: false` saves to the list without enrolling into the
   * campaigns it feeds - for standing searches, which verify an address
   * before deciding whether to enrol it.
   */
  async reveal(userId: string, input: RevealProspectInput, opts: { enrolListCampaigns?: boolean } = {}): Promise<RevealProspectResponse> {
    const enrol = opts.enrolListCampaigns !== false;
    const provider = getActiveProvider();
    if (!provider) throw new AppError('No prospect data provider is configured.', 503);
    if (!input?.provider_person_id) throw new AppError('provider_person_id is required', 400);
    const personId = String(input.provider_person_id);

    // Already paid for? Return the existing reveal, free.
    const { data: existing } = await supabaseAdmin
      .from('prospect_reveals')
      .select('contact_id, email')
      .eq('user_id', userId)
      .eq('provider', provider.id)
      .eq('provider_person_id', personId)
      .maybeSingle();
    if (existing) {
      const enrolledIn = existing.contact_id ? await saveToList(userId, input.list_id, existing.contact_id, enrol) : [];
      return {
        found: !!existing.email,
        email: existing.email,
        contact_id: existing.contact_id,
        already_revealed: true,
        credits: await creditsService.summary(userId),
        enrolled_in: enrolledIn,
      };
    }

    // Spend atomically, or refuse (403) and spend nothing.
    const spend = { amount: CREDIT_PRICES.reveal, action: 'reveal', provider: provider.id, ref: personId };
    const spentBucket = await creditsService.spend(userId, spend);

    // Get the email: search-time cache first, provider enrich as fallback.
    let email: string | null = null;
    let enriched: Partial<ProspectPerson> | undefined;
    const cached = searchEmailCache.get(cacheKey(userId, provider.id, personId));
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      email = cached.email;
    } else {
      try {
        const res = await withUsage(userId, 'reveal', () => provider.enrichEmail(personId, input.person));
        email = res.email;
        enriched = res.person;
      } catch (err: any) {
        // Provider failure → refund the credit to the bucket it came from.
        await creditsService.refund(userId, { ...spend, reason: 'provider_error', bucket: spentBucket });
        throw new AppError(err?.message || 'The data provider failed to enrich this lead. You were not charged.', 502);
      }
    }

    if (!email) {
      // No usable email → refund; only successful reveals cost credits.
      await creditsService.refund(userId, { ...spend, reason: 'no_email_found', bucket: spentBucket });
      return {
        found: false, email: null, contact_id: null, already_revealed: false,
        credits: await creditsService.summary(userId),
      };
    }

    // Build the contact from the search-row snapshot + any enrich payload.
    const snap = { ...(input.person || {}), ...(enriched || {}) };
    const contactRow: Record<string, any> = {
      user_id: userId,
      email: email.trim().toLowerCase(),
      first_name: snap.first_name || null,
      last_name: snap.last_name || null,
      company: snap.company || null,
      job_title: snap.job_title || null,
      linkedin_url: normalizeLinkedinUrl(snap.linkedin_url),
      website: snap.company_domain || null,
      location: snap.location || null,
      source: 'prospector',
      // Where exactly: the search that found them, shown in Leads.
      import_source: describeProspectSearch(input.search || {}),
      imported_at: new Date().toISOString(),
    };
    /*
     * Enrich somebody already known; never overwrite them.
     *
     * This was an upsert of the whole row, so revealing a person already in
     * the CRM replaced their name, company and title with whatever the
     * provider had - including nulls for anything it lacked - and rewrote
     * their source to 'prospector', erasing where they really came from.
     * What the account already knows beats what a data vendor guessed.
     */
    const { data: known } = await supabaseAdmin
      .from('contacts')
      .select('id, first_name, last_name, company, job_title, linkedin_url, website, location')
      .eq('user_id', userId)
      .eq('email', contactRow.email)
      .maybeSingle();

    let contact: { id: string } | null = null;
    let contactError: { message: string } | null = null;
    if (known) {
      const fill: Record<string, any> = {};
      for (const key of ['first_name', 'last_name', 'company', 'job_title', 'linkedin_url', 'website', 'location'] as const) {
        if (!(known as any)[key] && contactRow[key]) fill[key] = contactRow[key];
      }
      if (Object.keys(fill).length > 0) {
        // Filling blanks is a nicety: the person exists either way, so a
        // failed enrichment is not worth refunding the reveal over.
        const { error } = await supabaseAdmin.from('contacts').update(fill).eq('id', known.id).eq('user_id', userId);
        if (error) console.warn(`[Prospector] Could not enrich contact ${known.id}: ${error.message}`);
      }
      contact = { id: known.id };
    } else {
      const inserted = await supabaseAdmin
        .from('contacts')
        .upsert(contactRow, { onConflict: 'user_id,email' })
        .select('id')
        .single();
      contact = inserted.data;
      contactError = inserted.error;
    }
    if (contactError || !contact) {
      // Contact write failed → refund; the user was charged for nothing.
      await creditsService.refund(userId, { ...spend, reason: 'contact_write_error', bucket: spentBucket });
      throw new AppError(contactError?.message || 'Could not save the contact', 500);
    }

    const { error: revealInsertError } = await supabaseAdmin.from('prospect_reveals').insert({
      user_id: userId,
      provider: provider.id,
      provider_person_id: personId,
      contact_id: contact.id,
      email: contactRow.email,
    });

    let alreadyRevealed = false;
    if (revealInsertError) {
      if (revealInsertError.code === '23505') {
        // A concurrent duplicate request (e.g. a double-click) already recorded
        // this exact reveal under the unique (user_id, provider, provider_person_id)
        // constraint — refund the credit we just spent so the user isn't charged
        // twice for one reveal.
        await creditsService.refund(userId, { ...spend, reason: 'concurrent_reveal', bucket: spentBucket });
        alreadyRevealed = true;
      } else {
        // Any other insert failure → refund; the reveal was never recorded.
        await creditsService.refund(userId, { ...spend, reason: 'reveal_insert_error', bucket: spentBucket });
        throw new AppError(revealInsertError.message, 500);
      }
    }

    const enrolledIn = await saveToList(userId, input.list_id, contact.id, enrol);

    return {
      found: true,
      email: contactRow.email,
      contact_id: contact.id,
      already_revealed: alreadyRevealed,
      credits: await creditsService.summary(userId),
      enrolled_in: enrolledIn,
    };
  },

  /** Lead lists to save into, each with its folder and the campaigns it feeds. */
  async destinations(userId: string): Promise<ProspectDestination[]> {
    const lists = await listsService.list(userId, 'lead');
    if (!lists.length) return [];
    const [{ data: folders }, { data: campaigns, error }] = await Promise.all([
      supabaseAdmin.from('list_folders').select('id, name').eq('user_id', userId).eq('kind', 'lead'),
      supabaseAdmin
        .from('campaigns')
        .select('id, name, status, list_id')
        .eq('user_id', userId)
        .in('list_id', lists.map((l: any) => l.id))
        .not('status', 'in', `(${FINISHED.join(',')})`),
    ]);
    if (error) throw new AppError(error.message, 500);
    const folderName = new Map((folders || []).map((f: any) => [f.id, f.name as string]));
    return lists.map((l: any) => ({
      id: l.id,
      name: l.name,
      folder: l.folder_id ? folderName.get(l.folder_id) ?? null : null,
      contact_count: l.contact_count ?? 0,
      campaigns: (campaigns || []).filter((c: any) => c.list_id === l.id).map((c: any) => ({ id: c.id, name: c.name, status: c.status })),
    }));
  },
};

const FINISHED = ['completed', 'cancelled'];

/*
 * Prospect -> lead list -> campaign, in one step.
 *
 * Saving into a list that a campaign is already using used to stop at the
 * list: the lead sat there until somebody remembered to press "Import from
 * list" in the campaign. Now every unfinished campaign bound to the list
 * takes them straight away, through the same enrolment guards as any other
 * add (suppressed, unsubscribed, already in a campaign, on an open deal).
 * A failure here never undoes the reveal: the lead is saved and paid for.
 */
async function saveToList(userId: string, listId: string | null | undefined, contactId: string, enrol: boolean): Promise<{ id: string; name: string }[]> {
  if (!listId) return [];
  try {
    await listsService.addContacts(userId, listId, [contactId]);
  } catch (err: any) {
    console.warn(`[Prospector] Could not add contact ${contactId} to list ${listId}: ${err?.message || err}`);
    return [];
  }
  return enrol ? enrolIntoListCampaigns(userId, listId, contactId) : [];
}

/** Enrol one contact into every unfinished campaign bound to a lead list. */
export async function enrolIntoListCampaigns(userId: string, listId: string, contactId: string): Promise<{ id: string; name: string }[]> {
  const { data: campaigns } = await supabaseAdmin
    .from('campaigns')
    .select('id, name')
    .eq('user_id', userId)
    .eq('list_id', listId)
    .not('status', 'in', `(${FINISHED.join(',')})`);
  const enrolled: { id: string; name: string }[] = [];
  for (const campaign of campaigns || []) {
    try {
      const result = await campaignContactsService.add(campaign.id, [contactId]);
      if (result.added > 0) enrolled.push({ id: campaign.id, name: campaign.name });
    } catch (err: any) {
      console.warn(`[Prospector] Could not enrol contact ${contactId} in campaign ${campaign.id}: ${err?.message || err}`);
    }
  }
  return enrolled;
}

import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { billingService } from './billing.service.js';
import { listsService } from './lists.service.js';
import { getActiveProvider } from './prospect-providers.js';
import { PLANS } from '@lemlist/shared';
import type {
  ProspectCreditsSummary,
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

function monthStartIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}
function nextMonthIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
}

async function creditsSummary(userId: string): Promise<ProspectCreditsSummary> {
  const planId = await billingService.getPlanId(userId);
  const allowance = PLANS[planId].prospectCredits;

  // Plan bucket: this month's movements against the resetting allowance.
  const { data: planRows, error: planError } = await supabaseAdmin
    .from('prospect_credit_ledger')
    .select('delta')
    .eq('user_id', userId)
    .eq('bucket', 'plan')
    .gte('created_at', monthStartIso());
  if (planError) throw new AppError(planError.message, 500);
  const planNet = (planRows || []).reduce((s, r: any) => s + (r.delta || 0), 0);
  const used = Math.max(0, -planNet);
  const planRemaining = allowance < 0 ? -1 : Math.max(0, allowance - used);

  // Purchased bucket: persistent balance, never expires.
  const { data: purchasedRows, error: purchasedError } = await supabaseAdmin
    .from('prospect_credit_ledger')
    .select('delta')
    .eq('user_id', userId)
    .eq('bucket', 'purchased');
  if (purchasedError) throw new AppError(purchasedError.message, 500);
  const purchased = Math.max(0, (purchasedRows || []).reduce((s, r: any) => s + (r.delta || 0), 0));

  return {
    allowance,
    used,
    plan_remaining: planRemaining,
    purchased,
    remaining: allowance < 0 ? -1 : planRemaining + purchased,
    resets_at: nextMonthIso(),
  };
}

export const prospectingService = {
  async status(userId: string): Promise<ProspectorStatus> {
    const provider = getActiveProvider();
    return { provider: provider?.id ?? null, credits: await creditsSummary(userId) };
  },

  async search(userId: string, filters: ProspectSearchFilters, page = 1): Promise<ProspectSearchResponse> {
    const provider = getActiveProvider();
    if (!provider) {
      throw new AppError('No prospect data provider is configured. Add a PDL_API_KEY or APOLLO_API_KEY to enable the prospector.', 503);
    }
    const perPage = 25;
    const safePage = Math.min(Math.max(1, Number(page) || 1), 40);
    const { results, total, emailsById } = await provider.search(filters, safePage, perPage);

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

    return { results, page: safePage, total, provider: provider.id };
  },

  async reveal(userId: string, input: RevealProspectInput): Promise<RevealProspectResponse> {
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
      if (input.list_id && existing.contact_id) {
        await listsService.addContacts(userId, input.list_id, [existing.contact_id]).catch(() => {});
      }
      return {
        found: !!existing.email,
        email: existing.email,
        contact_id: existing.contact_id,
        already_revealed: true,
        credits: await creditsSummary(userId),
      };
    }

    // Spend one credit atomically: monthly plan allowance first, then the
    // purchased (never-expiring) balance.
    const planId = await billingService.getPlanId(userId);
    const allowance = PLANS[planId].prospectCredits;
    const { data: spendRows, error: spendError } = await supabaseAdmin.rpc('try_spend_prospect_credits', {
      p_user_id: userId,
      p_amount: 1,
      p_allowance: allowance,
      p_reason: 'reveal',
      p_provider: provider.id,
      p_provider_person_id: personId,
    });
    if (spendError) throw new AppError(spendError.message, 500);
    const spend = Array.isArray(spendRows) ? spendRows[0] : spendRows;
    const spentBucket: string | null = spend?.spent_bucket ?? null;
    if (!spentBucket) {
      throw new AppError('You’re out of prospect credits. Buy a credit pack or upgrade your plan to keep revealing leads.', 403);
    }

    // Get the email: search-time cache first, provider enrich as fallback.
    let email: string | null = null;
    let enriched: Partial<ProspectPerson> | undefined;
    const cached = searchEmailCache.get(cacheKey(userId, provider.id, personId));
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      email = cached.email;
    } else {
      try {
        const res = await provider.enrichEmail(personId);
        email = res.email;
        enriched = res.person;
      } catch (err: any) {
        // Provider failure → refund the credit to the bucket it came from.
        await supabaseAdmin.from('prospect_credit_ledger').insert({
          user_id: userId, delta: 1, kind: 'refund', reason: 'provider_error',
          provider: provider.id, provider_person_id: personId, bucket: spentBucket,
        });
        throw new AppError(err?.message || 'The data provider failed to enrich this lead. You were not charged.', 502);
      }
    }

    if (!email) {
      // No usable email → refund; only successful reveals cost credits.
      await supabaseAdmin.from('prospect_credit_ledger').insert({
        user_id: userId, delta: 1, kind: 'refund', reason: 'no_email_found',
        provider: provider.id, provider_person_id: personId, bucket: spentBucket,
      });
      return {
        found: false, email: null, contact_id: null, already_revealed: false,
        credits: await creditsSummary(userId),
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
      linkedin_url: snap.linkedin_url || null,
      website: snap.company_domain || null,
      location: snap.location || null,
      source: 'prospector',
    };
    const { data: contact, error: contactError } = await supabaseAdmin
      .from('contacts')
      .upsert(contactRow, { onConflict: 'user_id,email' })
      .select('id')
      .single();
    if (contactError) throw new AppError(contactError.message, 500);

    await supabaseAdmin.from('prospect_reveals').insert({
      user_id: userId,
      provider: provider.id,
      provider_person_id: personId,
      contact_id: contact.id,
      email: contactRow.email,
    });

    if (input.list_id) {
      await listsService.addContacts(userId, input.list_id, [contact.id]).catch(() => {});
    }

    return {
      found: true,
      email: contactRow.email,
      contact_id: contact.id,
      already_revealed: false,
      credits: await creditsSummary(userId),
    };
  },
};

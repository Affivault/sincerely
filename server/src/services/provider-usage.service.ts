import { AsyncLocalStorage } from 'node:async_hooks';
import { env } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';

/*
 * What every paid data call cost us, and for whom.
 *
 * The account and the action ride along with the request in async context,
 * so the one Icypeas wrapper can record each call without every caller
 * passing them down. A call made outside any context (none today) is not
 * recorded: there is nobody to put it against.
 */

interface UsageContext { userId: string | null; action: string }

const context = new AsyncLocalStorage<UsageContext>();

/** Run `fn` with its provider calls recorded against this account and action. */
export function withUsage<T>(userId: string | null, action: string, fn: () => Promise<T>): Promise<T> {
  return context.run({ userId, action }, fn);
}

/** Record one paid call. Never throws and never waits: a log row must not fail the action. */
export function recordProviderUsage(endpoint: string, providerCredits: number, provider = 'icypeas'): void {
  const ctx = context.getStore();
  if (!ctx || !(providerCredits > 0)) return;
  const row = {
    user_id: ctx.userId,
    action: ctx.action,
    provider,
    endpoint: endpoint.replace(/\?.*$/, ''),
    provider_credits: Math.round(providerCredits * 100) / 100,
    cost_usd: Math.round(providerCredits * env.ICYPEAS_USD_PER_CREDIT * 100000) / 100000,
  };
  try {
    supabaseAdmin.from('provider_usage').insert(row).then(
      ({ error }: { error: { message: string } | null }) => {
        if (error) console.warn(`[Usage] Could not record ${row.endpoint}: ${error.message}`);
      },
      (err: unknown) => console.warn(`[Usage] Could not record ${row.endpoint}:`, (err as Error)?.message),
    );
  } catch (err) {
    console.warn(`[Usage] Could not record ${row.endpoint}:`, (err as Error)?.message);
  }
}

/*
 * Icypeas credits a synchronous call used, from its answer (their price list:
 * api-doc.icypeas.com/how-works/credit-cost). The email finder and the
 * verifier settle later and are recorded when their result is read.
 */
const NOT_FOUND = /^(NOT_FOUND|DEBITED_NOT_FOUND|NOT_DEBITED)$/i;

export function icypeasCallCredits(path: string, data: any): number {
  const route = path.replace(/\?.*$/, '');
  const status = String(data?.status ?? data?.item?.status ?? '');
  if (route === '/find-people' || route === '/find-companies') {
    return 0.02 * (Array.isArray(data?.leads) ? data.leads.length : 0);
  }
  if (route.startsWith('/url-search/')) {
    return NOT_FOUND.test(status) || !/linkedin\.com\//i.test(JSON.stringify(data ?? '')) ? 0 : 1;
  }
  if (route === '/scrape/profile' || route === '/scrape/company') {
    // Their answer shape is undocumented: anything beyond the envelope counts as a find.
    const found = !NOT_FOUND.test(status) && data && typeof data === 'object'
      && Object.keys(data).some((k) => !['success', 'status', 'message', 'error'].includes(k));
    return found ? (route === '/scrape/profile' ? 1.5 : 0.5) : 0;
  }
  return 0;
}

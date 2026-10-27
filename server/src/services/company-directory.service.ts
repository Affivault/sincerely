import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { companyDirectoryQuery, hasCompanyFilters } from './company-directory.js';
import type { CompanyDirectoryStatus, CompanySearchFilters, CompanySearchResponse, DirectoryCompany } from '@lemlist/shared';

/*
 * Company search served from our own copy of the PDL Free Company Dataset
 * (migration 098), so it spends no provider credits. The table is empty
 * until the importer has run; status() says so and the client hides the tab.
 */

const PER_PAGE = 25;
const MAX_PAGE = 40;
const COLUMNS = 'id, name, domain, linkedin_url, founded, size, industry, country, region, locality';

// The row count only changes when someone runs the importer, so it is asked
// for once every few minutes rather than on every Prospector visit.
let statusCache: { value: CompanyDirectoryStatus; at: number } | null = null;
const STATUS_TTL_MS = 10 * 60 * 1000;

export const companyDirectoryService = {
  async status(): Promise<CompanyDirectoryStatus> {
    if (statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) return statusCache.value;
    const { count, error } = await supabaseAdmin
      .from('company_directory')
      .select('id', { count: 'estimated', head: true });
    // A missing table means migration 098 has not been run: not an error for the user.
    if (error) console.warn(`[CompanyDirectory] status unavailable: ${error.message}`);
    const companies = error ? 0 : count || 0;
    const value = { available: companies > 0, companies };
    statusCache = { value, at: Date.now() };
    return value;
  },

  async search(filters: CompanySearchFilters, page = 1): Promise<CompanySearchResponse> {
    const q = companyDirectoryQuery(filters || {});
    // Unfiltered, this is a page through 22M rows: not a search anyone means.
    if (!hasCompanyFilters(q)) throw new AppError('Add at least one filter to search companies.', 400);
    const safePage = Math.min(Math.max(1, Number(page) || 1), MAX_PAGE);
    const from = (safePage - 1) * PER_PAGE;

    let query = supabaseAdmin
      .from('company_directory')
      .select(COLUMNS, { count: 'estimated' })
      .order('id')
      .range(from, from + PER_PAGE - 1);
    if (q.companyOr) query = query.or(q.companyOr);
    if (q.locationOr) query = query.or(q.locationOr);
    if (q.industries.length) query = query.in('industry', q.industries);
    if (q.sizes.length) query = query.in('size', q.sizes);

    const { data, count, error } = await query;
    if (error) throw new AppError(`Company search failed: ${error.message}`, 500);
    const results = (data || []) as DirectoryCompany[];
    return { results, page: safePage, total: Math.max(count ?? 0, from + results.length) };
  },
};

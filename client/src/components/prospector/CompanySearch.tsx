import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Building2, MapPin, Sparkles, Search, Linkedin, ChevronLeft, ChevronRight, SearchX, Users, Globe } from 'lucide-react';
import { COMPANY_DIRECTORY_ATTRIBUTION, CREDIT_PRICES, PROSPECT_INDUSTRIES, creditsLabel } from '@lemlist/shared';
import type { CompanySearchResponse, CompanySearchFilters, DirectoryCompany } from '@lemlist/shared';
import { prospectingApi } from '../../api/prospecting.api';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { EmptyState } from '../shared/EmptyState';
import { cn } from '../../lib/utils';
import { ChipInput } from './ChipInput';

const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001-10000', '10001+'];

/* The directory uses LinkedIn's industry names and matches them exactly. */
const INDUSTRIES = [
  'computer software', 'information technology and services', 'internet', 'marketing and advertising',
  'financial services', 'staffing and recruiting', 'management consulting', 'real estate', 'construction',
  'hospital & health care', 'retail', 'e-learning', 'education management', 'accounting', 'law practice',
  'insurance', 'telecommunications', 'automotive', 'logistics and supply chain', 'design', 'events services',
  'health, wellness and fitness', 'food & beverages', 'consumer goods', 'architecture & planning',
  'venture capital & private equity', 'investment management', 'nonprofit organization management',
  'mechanical or industrial engineering', 'renewables & environment', 'apparel & fashion', 'leisure, travel & tourism',
];

const titleCase = (s: string | null) => (s ? s.replace(/\b\w/g, (c) => c.toUpperCase()) : '');
const place = (c: DirectoryCompany) => [c.locality, c.region, c.country].filter(Boolean).map(titleCase).join(', ');

/**
 * Company search over our own copy of the PDL Free Company Dataset when it
 * is loaded (free), otherwise Icypeas's company database, priced like a
 * people search: CREDIT_PRICES.search for each new page of 25.
 * Picking companies hands their domains to the people search; clicking one
 * opens its company page in the panel.
 */
export function CompanySearch({ onFindPeople, onOpen, icypeas = false }: { onFindPeople: (domains: string[]) => void; onOpen: (c: DirectoryCompany) => void; icypeas?: boolean }) {
  const [companies, setCompanies] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [companySizes, setCompanySizes] = useState<string[]>([]);
  const [results, setResults] = useState<CompanySearchResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const requestIdRef = useRef(0);

  const filters: CompanySearchFilters = { companies, locations, industries, companySizes };
  const hasFilters = companies.length + locations.length + industries.length + companySizes.length > 0;

  const search = useMutation({
    mutationFn: ({ p }: { p: number; requestId: number }) => prospectingApi.searchCompanies(filters, p),
    onSuccess: (data, vars) => {
      if (vars.requestId !== requestIdRef.current) return;
      setResults(data);
      setSelected(new Set());
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Company search failed'),
  });

  const run = (p = 1) => {
    if (!hasFilters) { toast('Add at least one filter to search.', { icon: '🔎' }); return; }
    search.mutate({ p, requestId: ++requestIdRef.current });
  };

  const page = results?.page ?? 1;
  const fromDirectory = results?.source !== 'icypeas';
  const totalPages = results ? Math.max(1, Math.ceil(Math.min(results.total, 1000) / 25)) : 1;
  const withDomain = (results?.results || []).filter((c) => c.domain);
  const allSelected = withDomain.length > 0 && withDomain.every((c) => selected.has(c.domain!));
  const toggle = (domain: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(domain)) next.delete(domain); else next.add(domain);
    return next;
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 items-start">
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-3.5 lg:sticky lg:top-4">
        <div className="flex items-center justify-between">
          <p className="text-caption font-medium text-[var(--text-tertiary)] flex items-center gap-1.5">
            <Search className="h-3 w-3" /> Company filters
          </p>
          {hasFilters && (
            <button
              onClick={() => { setCompanies([]); setLocations([]); setIndustries([]); setCompanySizes([]); }}
              className="text-caption font-medium text-[var(--text-tertiary)] hover:text-[var(--indigo-text)] transition-colors"
            >
              Clear all
            </button>
          )}
        </div>
        <ChipInput label="Industry" icon={Sparkles} values={industries} onChange={setIndustries} placeholder={icypeas ? 'Software Development…' : 'computer software…'} suggestions={icypeas ? PROSPECT_INDUSTRIES : INDUSTRIES} />
        <ChipInput label="Location" icon={MapPin} values={locations} onChange={setLocations} placeholder="United Kingdom, London…" />
        <ChipInput label="Company" icon={Building2} values={companies} onChange={setCompanies} placeholder="Name starts with, or domain…" />
        <div>
          <span className="flex items-center gap-1.5 text-caption font-medium text-[var(--text-secondary)] mb-1">
            <Users className="h-3 w-3 text-[var(--text-tertiary)]" /> Company size
          </span>
          <div className="flex flex-wrap gap-1">
            {COMPANY_SIZES.map((s) => {
              const on = companySizes.includes(s);
              return (
                <button
                  key={s}
                  onClick={() => setCompanySizes(on ? companySizes.filter((x) => x !== s) : [...companySizes, s])}
                  className={cn(
                    'h-6 px-2 rounded-md text-caption font-medium border tabular transition-colors',
                    on ? 'bg-[var(--indigo-subtle)] border-[rgba(47,63,156,0.3)] text-[var(--indigo-text)]' : 'border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:border-[var(--border-default)] hover:text-[var(--text-secondary)]'
                  )}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>
        <Button className="w-full" onClick={() => run(1)} disabled={search.isPending}>
          {search.isPending ? <><Spinner size="sm" /> Searching…</> : <><Search className="h-3.5 w-3.5" /> Search companies</>}
        </Button>
        <p className="text-caption text-[var(--text-tertiary)]">Free from our company directory. From the live database, each new page of 25 costs {creditsLabel(CREDIT_PRICES.search)}.</p>
      </div>

      <div className="min-w-0 space-y-3">
        {selected.size > 0 && (
          <div className="flex items-center gap-2.5 rounded-lg border border-[var(--indigo)]/25 bg-[var(--indigo-subtle)] px-3 py-2">
            <span className="text-body font-medium text-[var(--text-primary)]">{selected.size} selected</span>
            <span className="flex-1" />
            <Button size="sm" variant="secondary" onClick={() => setSelected(new Set())}>Clear</Button>
            <Button size="sm" onClick={() => onFindPeople([...selected])}>
              <Users className="h-3 w-3" /> Find people at {selected.size}
            </Button>
          </div>
        )}

        {!results ? (
          <div className="rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--bg-surface)] py-20 text-center px-6">
            <Building2 className="h-8 w-8 text-[var(--text-tertiary)] mx-auto mb-3" />
            <p className="text-heading font-semibold text-[var(--text-primary)]">Build your account list first</p>
            <p className="text-body text-[var(--text-tertiary)] mt-1 max-w-md mx-auto">
              Filter companies by industry, location and size, click one to see its page, then find the right people at the ones you pick.
            </p>
          </div>
        ) : results.results.length === 0 ? (
          <EmptyState icon={SearchX} title="No companies match those filters" description="Industries match exactly, so try one from the suggestions, or remove a filter." />
        ) : (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
            <div className="flex items-center justify-end px-4 h-9 border-b border-[var(--border-subtle)]">
              <span className="text-body text-[var(--text-tertiary)] tabular">
                {results.total.toLocaleString()} compan{results.total === 1 ? 'y' : 'ies'}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-caption font-medium text-[var(--text-tertiary)]">
                    <th className="py-2.5 pl-4 pr-2 w-8">
                      {withDomain.length > 0 && (
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={() => setSelected((prev) => {
                            const next = new Set(prev);
                            if (allSelected) withDomain.forEach((c) => next.delete(c.domain!));
                            else withDomain.forEach((c) => next.add(c.domain!));
                            return next;
                          })}
                          aria-label="Select all companies on this page"
                          className="h-3.5 w-3.5 rounded border-[var(--border-default)]"
                        />
                      )}
                    </th>
                    <th className="py-2.5 pr-3">Company</th>
                    <th className="py-2.5 px-3">Industry</th>
                    <th className="py-2.5 px-3">Location</th>
                    <th className="py-2.5 pr-4 pl-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {results.results.map((c) => (
                    <tr key={c.id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-hover)] transition-colors">
                      <td className="py-2.5 pl-4 pr-2 w-8">
                        {c.domain && (
                          <input
                            type="checkbox"
                            checked={selected.has(c.domain)}
                            onChange={() => toggle(c.domain!)}
                            aria-label={`Select ${c.name}`}
                            className="h-3.5 w-3.5 rounded border-[var(--border-default)]"
                          />
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <button type="button" onClick={() => onOpen(c)} title="See the company and its people" className="text-strong font-medium text-[var(--text-primary)] hover:text-[var(--indigo-text)] hover:underline truncate max-w-[220px] text-left">{fromDirectory ? titleCase(c.name) : c.name}</button>
                          {c.linkedin_url && (
                            <a href={c.linkedin_url} target="_blank" rel="noopener noreferrer" className="relative text-[var(--text-tertiary)] hover:text-[#0A66C2] transition-colors flex-shrink-0 after:absolute after:-inset-1.5 after:content-['']" title="Open LinkedIn" aria-label={`Open ${c.name} on LinkedIn`}>
                              <Linkedin className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                        <p className="text-caption text-[var(--text-tertiary)] truncate">
                          {c.domain ? (
                            <a href={`https://${c.domain}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-[var(--indigo-text)]">
                              <Globe className="h-2.5 w-2.5" /> {c.domain}
                            </a>
                          ) : 'No website'}
                          {c.size && <span> · {c.size} people</span>}
                          {c.founded && <span> · since {c.founded}</span>}
                        </p>
                      </td>
                      <td className="py-2.5 px-3 text-body text-[var(--text-secondary)] truncate max-w-[180px]">{(fromDirectory ? titleCase(c.industry) : c.industry) || '—'}</td>
                      <td className="py-2.5 px-3 text-body text-[var(--text-secondary)] truncate max-w-[180px]">{place(c) || '—'}</td>
                      <td className="py-2.5 pr-4 pl-3">
                        <div className="flex justify-end">
                          <Button size="sm" variant="secondary" disabled={!c.domain} onClick={() => c.domain && onFindPeople([c.domain])} title={c.domain ? 'Search people who work here' : 'No website, so nobody here can be emailed'}>
                            <Users className="h-3 w-3" /> Find people
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-4 h-11 border-t border-[var(--border-subtle)]">
              <span className="text-caption text-[var(--text-tertiary)] tabular">Page {page} of {totalPages}</span>
              <div className="flex items-center gap-1">
                <button aria-label="Previous page" onClick={() => run(page - 1)} disabled={page <= 1 || search.isPending} className="icon-btn h-7 w-7 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                <button aria-label="Next page" onClick={() => run(page + 1)} disabled={page >= totalPages || search.isPending} className="icon-btn h-7 w-7 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
              </div>
            </div>
          </div>
        )}

        {/* CC BY 4.0 requires this credit wherever the data is shown. */}
        {fromDirectory && results && <p className="text-caption text-[var(--text-tertiary)]">
          Company data:{' '}
          <a href={COMPANY_DIRECTORY_ATTRIBUTION.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{COMPANY_DIRECTORY_ATTRIBUTION.source}</a>, licensed{' '}
          <a href={COMPANY_DIRECTORY_ATTRIBUTION.licenseUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{COMPANY_DIRECTORY_ATTRIBUTION.license}</a>.
        </p>}
      </div>
    </div>
  );
}

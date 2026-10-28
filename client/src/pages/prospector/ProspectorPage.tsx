import { StandingSearches, SaveStandingSearch } from '../../components/prospector/StandingSearches';
import { CompanySearch } from '../../components/prospector/CompanySearch';
import { FilterPanel, EMPTY_FILTERS, DEFAULT_OPEN_ROWS, ALL_ROWS, countFilters, type FilterState } from '../../components/prospector/FilterPanel';
import { useDebounce } from '../../hooks/useDebounce';
import { DestinationPicker, rememberedListId } from '../../components/prospector/DestinationPicker';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { prospectingApi } from '../../api/prospecting.api';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import { Avatar } from '../../components/shared/Avatar';
import { AddToCampaignModal } from '../../components/shared/AddToCampaignModal';
import { PageHeader } from '../../components/shared/PageHeader';
import { cn } from '../../lib/utils';
import {
  Radar, Search, Building2, Users,
  Lock, Unlock, CheckCircle2, ChevronLeft, ChevronRight, X,
  Linkedin, ArrowUpRight, Coins, KeyRound, FolderOpen, Plus, Megaphone, AlertTriangle, SearchX,
} from 'lucide-react';
import { CREDIT_PACKS, formatDayMonth, countAdvancedFilters } from '@lemlist/shared';
import { EmptyState } from '../../components/shared/EmptyState';
import type {
  ProspectPerson, ProspectSearchFilters, ProspectSearchResponse,
} from '@lemlist/shared';

function CreditsMeter({ allowance, planRemaining, purchased, onBuy }: {
  allowance: number; planRemaining: number; purchased: number; onBuy: () => void;
}) {
  if (allowance < 0) {
    return <span className="text-body font-medium text-[var(--text-secondary)]">Unlimited credits</span>;
  }
  const pct = allowance > 0 ? Math.max(0, Math.min(100, (planRemaining / allowance) * 100)) : 0;
  const low = pct <= 15 && purchased === 0;
  return (
    <div className="flex items-center gap-2.5 flex-wrap">
      <Coins className={cn('h-4 w-4', low ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--indigo-text)]')} />
      <div className="w-28 h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', low ? 'bg-amber-500' : '[background:var(--indigo-grad)]')} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-body font-medium text-[var(--text-primary)] tabular">
        {planRemaining}<span className="text-[var(--text-tertiary)]">/{allowance}</span>
        {purchased > 0 && <span className="text-[var(--indigo-text)]"> +{purchased.toLocaleString()}</span>}
        <span className="text-[var(--text-tertiary)]"> credits</span>
      </span>
      <Button size="sm" variant="secondary" onClick={onBuy}><Plus className="h-3 w-3" /> Buy credits</Button>
    </div>
  );
}

/** Credit-pack picker → Stripe checkout redirect. */
function BuyCreditsModal({ onClose }: { onClose: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const buy = async (packId: string) => {
    setBusyId(packId);
    try {
      const { url } = await prospectingApi.buyCredits(packId);
      window.location.href = url;
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Could not start checkout.');
      setBusyId(null);
    }
  };
  return (
    <Modal isOpen onClose={onClose} title="Buy prospect credits" description="Purchased credits never expire and are used after your monthly plan credits." size="md">
      <div className="space-y-2">
        {CREDIT_PACKS.map((pack) => {
          const perCredit = pack.priceUsd / pack.credits;
          return (
            <div key={pack.id} className="flex items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] flex-shrink-0">
                <Coins className="h-4 w-4 text-[var(--indigo-text)]" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-strong font-semibold text-[var(--text-primary)] tabular">
                  {pack.credits.toLocaleString()} credits
                  <span className="ml-2 inline-flex items-center px-1.5 h-[17px] text-micro font-medium bg-[var(--bg-elevated)] text-[var(--text-tertiary)] rounded">{pack.label}</span>
                </p>
                <p className="text-caption text-[var(--text-tertiary)]">${perCredit.toFixed(3)} per lead</p>
              </div>
              <Button variant={pack.id === 'pack_2000' ? 'primary' : 'secondary'} disabled={busyId !== null} onClick={() => buy(pack.id)}>
                {busyId === pack.id ? 'Redirecting…' : `$${pack.priceUsd}`}
              </Button>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-caption text-[var(--text-tertiary)]">Secure checkout via Stripe. Credits appear within a few seconds of payment.</p>
    </Modal>
  );
}

export function ProspectorPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [buyOpen, setBuyOpen] = useState(false);

  // Back from Stripe checkout — confirm and refresh the balance.
  useEffect(() => {
    const status = searchParams.get('credits');
    if (!status) return;
    if (status === 'success') {
      toast.success('Payment received — your credits will appear in a few seconds.');
      const t = setTimeout(() => qc.invalidateQueries({ queryKey: ['prospecting', 'status'] }), 4000);
      setSearchParams({}, { replace: true });
      return () => clearTimeout(t);
    }
    if (status === 'cancel') {
      toast('Checkout cancelled — no charge was made.', { icon: 'ℹ️' });
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filters
  const [form, setForm] = useState<FilterState>(EMPTY_FILTERS);
  const [openRows, setOpenRows] = useState<Set<string>>(() => new Set(DEFAULT_OPEN_ROWS));
  const toggleRow = (id: string) => setOpenRows((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const allOpen = openRows.size >= ALL_ROWS.length;
  const [saveRuleOpen, setSaveRuleOpen] = useState(false);
  const [tab, setTab] = useState<'people' | 'companies'>('people');
  const [page, setPage] = useState(1);
  const [listId, setListId] = useState(rememberedListId);
  const [results, setResults] = useState<ProspectSearchResponse | null>(null);
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRevealing, setBulkRevealing] = useState(false);
  const [campaignContactIds, setCampaignContactIds] = useState<string[] | null>(null);
  // Set while a bulk reveal is looping through mutateAsync calls, so the
  // per-reveal toasts stay quiet and one summary toast speaks for all of them.
  const suppressRevealToastsRef = useRef(false);

  const { data: status, isError: statusError } = useQuery({ queryKey: ['prospecting', 'status'], queryFn: prospectingApi.status, meta: { silentError: true } });

  const filters: ProspectSearchFilters = {
    titles: form.titles, locations: form.locations, industries: form.industries, companies: form.companies,
    seniorities: form.seniorities, companySizes: form.companySizes,
    keywords: form.keywords.trim() || undefined,
    advanced: countAdvancedFilters(form.advanced) ? form.advanced : undefined,
  };
  const activeFilters = countFilters(form);
  const hasFilters = activeFilters > 0;
  // The search that produced the rows on screen, recorded on each saved lead.
  const lastSearchRef = useRef<ProspectSearchFilters>({});

  // Guards against a slower, now-stale search response overwriting the
  // results of a newer one (e.g. pressing Enter twice in quick succession).
  const searchRequestIdRef = useRef(0);

  // `f` is passed when the filters were set in this same tick (Find people
  // from the Companies tab), before React has re-rendered with them.
  const searchMutation = useMutation({
    mutationFn: ({ p, f }: { p: number; requestId: number; f?: ProspectSearchFilters }) => prospectingApi.search(f ?? filters, p),
    onSuccess: (data, vars) => {
      if (vars.requestId !== searchRequestIdRef.current) return;
      lastSearchRef.current = vars.f ?? filters;
      setResults(data);
      setPage(vars.p);
      setSelectedIds(new Set());
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Search failed'),
  });

  const revealMutation = useMutation({
    mutationFn: (person: ProspectPerson) => prospectingApi.reveal({
      provider: person.provider,
      provider_person_id: person.id,
      person,
      list_id: listId || null,
      search: lastSearchRef.current,
    }),
    onMutate: (person) => setRevealingId(person.id),
    onSuccess: (res, person) => {
      qc.invalidateQueries({ queryKey: ['prospecting', 'status'] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
      if (res.enrolled_in?.length) qc.invalidateQueries({ queryKey: ['campaigns'] });
      if (res.found) {
        setResults((prev) => prev ? {
          ...prev,
          results: prev.results.map((r) => r.id === person.id ? { ...r, already_revealed: true, contact_id: res.contact_id } : r),
        } : prev);
        if (!suppressRevealToastsRef.current) {
          const into = res.enrolled_in?.length ? ` and added to ${res.enrolled_in.map((c) => c.name).join(', ')}` : '';
          toast.success(res.already_revealed ? `Already unlocked: ${res.email}${into}` : `Saved ${res.email} to your leads${listId ? ' list' : ''}${into}`);
        }
      } else if (!suppressRevealToastsRef.current) {
        toast(`No verified email found for ${person.full_name} — you weren't charged.`, { icon: 'ℹ️' });
      }
    },
    onError: (e: any) => { if (!suppressRevealToastsRef.current) toast.error(e.response?.data?.error || 'Reveal failed'); },
    onSettled: () => setRevealingId(null),
  });

  // Reveals every selected, not-yet-unlocked row in sequence — parallel reveals
  // would race the credit balance. Stops issuing new calls once credits are
  // spent (a "not found" reveal isn't charged, so the count only drops on a hit).
  const bulkReveal = async () => {
    const targets = (results?.results || []).filter((p) => selectedIds.has(p.id) && !p.already_revealed);
    if (targets.length === 0) return;
    setBulkRevealing(true);
    suppressRevealToastsRef.current = true;
    let remaining = credits ? credits.remaining : -1; // -1 = unlimited
    let revealed = 0, noEmail = 0, failed = 0, skipped = 0;
    const joined = new Map<string, string>();
    try {
      for (const person of targets) {
        if (remaining === 0) { skipped++; continue; }
        try {
          const res = await revealMutation.mutateAsync(person);
          if (res.found) { revealed++; if (remaining > 0) remaining--; } else { noEmail++; }
          for (const c of res.enrolled_in || []) joined.set(c.id, c.name);
        } catch {
          failed++;
        }
      }
    } finally {
      suppressRevealToastsRef.current = false;
      setBulkRevealing(false);
      setSelectedIds(new Set());
    }
    const parts: string[] = [];
    if (revealed) parts.push(`${revealed} revealed`);
    if (noEmail) parts.push(`${noEmail} had no email`);
    if (failed) parts.push(`${failed} failed`);
    if (skipped) parts.push(`${skipped} skipped — out of credits`);
    if (joined.size) parts.push(`added to ${[...joined.values()].join(', ')}`);
    toast(parts.join(', ') || 'Nothing to reveal', { icon: revealed ? '✅' : 'ℹ️' });
  };

  const toggleSelect = (id: string) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const runSearch = (p = 1) => {
    if (!hasFilters) { toast('Add at least one filter to search.', { icon: '🔎' }); return; }
    const requestId = ++searchRequestIdRef.current;
    searchMutation.mutate({ p, requestId });
  };

  const credits = status?.credits;
  const providerReady = !!status?.provider;
  const directoryReady = !!status?.company_directory?.available;
  const fullFilters = status?.provider === 'icypeas';

  // How many people match, live and free, while filters change.
  const countKey = useDebounce(JSON.stringify(filters), 600);
  const { data: liveCount, isFetching: counting } = useQuery({
    queryKey: ['prospecting', 'count', countKey],
    queryFn: ({ signal }) => prospectingApi.count(JSON.parse(countKey) as ProspectSearchFilters, signal),
    enabled: fullFilters && hasFilters,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
    meta: { silentError: true },
  });
  const matchCount = hasFilters ? liveCount?.total ?? null : null;

  // Companies at the picked domains, keeping any title or seniority already set.
  const findPeopleAt = (domains: string[]) => {
    setForm((prev) => ({ ...prev, companies: domains }));
    setTab('people');
    if (!providerReady) return;
    const requestId = ++searchRequestIdRef.current;
    searchMutation.mutate({ p: 1, requestId, f: { ...filters, companies: domains } });
  };
  const totalPages = results ? Math.max(1, Math.ceil(Math.min(results.total, 1000) / 25)) : 1;

  return (
    <div>
      <PageHeader
        icon={Radar}
        title="Prospector"
        description="Search 100M+ B2B profiles, reveal verified emails, and drop them straight into your lists."
        actions={credits && (
          <CreditsMeter
            allowance={credits.allowance}
            planRemaining={credits.plan_remaining}
            purchased={credits.purchased}
            onBuy={() => setBuyOpen(true)}
          />
        )}
      />

      {/* Status fetch failed — the credits meter and provider banner below silently
          don't render on error, so surface it explicitly instead of looking fine. */}
      {statusError && (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 mb-5 flex items-start gap-3 shadow-[inset_3px_0_0_theme(colors.red.500)]">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-500/10 flex-shrink-0">
            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
          </span>
          <div className="min-w-0 text-body flex-1">
            <p className="font-semibold text-[var(--text-primary)]">Couldn't load Prospector status</p>
            <p className="text-[var(--text-secondary)]">Credit balance and provider connection couldn't be checked — this doesn't mean they're unavailable.</p>
          </div>
          <button onClick={() => qc.invalidateQueries({ queryKey: ['prospecting', 'status'] })} className="text-body font-semibold text-[var(--indigo-text)] hover:underline flex-shrink-0">Retry</button>
        </div>
      )}

      {/* Provider not configured */}
      {status && !providerReady && (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 mb-5 flex items-start gap-3 shadow-[inset_3px_0_0_theme(colors.amber.500)]">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 flex-shrink-0">
            <KeyRound className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </span>
          <div className="min-w-0 text-body">
            <p className="font-medium text-[var(--text-primary)]">Connect a data provider to switch on the Prospector</p>
            <p className="text-[var(--text-secondary)] mt-0.5">
              Add an <code className="bg-[var(--bg-elevated)] px-1 py-0.5 rounded text-caption">ICYPEAS_API_KEY</code> (Icypeas) or{' '}
              <code className="bg-[var(--bg-elevated)] px-1 py-0.5 rounded text-caption">PDL_API_KEY</code> (People Data Labs) to the server environment and restart.
              Search, credits, reveals and lead-list saving are already wired up — the key is the only missing piece.
            </p>
          </div>
        </div>
      )}

      {/* Companies come from our own free directory once it is loaded; people
          (and their emails) always come from the paid provider. */}
      {directoryReady && (
        <div role="tablist" aria-label="Search for" className="inline-flex items-center gap-0.5 p-0.5 mb-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          {([
            ['people', 'People', Users],
            ['companies', 'Companies', Building2],
          ] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                'inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-body font-medium transition-colors',
                tab === id ? 'bg-[var(--indigo-subtle)] text-[var(--indigo-text)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
              {id === 'companies' && <span className="ml-0.5 inline-flex items-center px-1.5 h-[17px] text-micro font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded">Free</span>}
            </button>
          ))}
        </div>
      )}

      {tab === 'companies' && directoryReady ? (
        <CompanySearch onFindPeople={findPeopleAt} />
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 items-start">
        {/* Filters: every one in view, no hidden step. */}
        {/* On wide screens the panel scrolls on its own, so results stay in view beside it. */}
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] lg:sticky lg:top-4 lg:flex lg:flex-col lg:max-h-[calc(100vh-10rem)]">
          <div className="flex items-center justify-between px-4 pt-4 pb-3 flex-shrink-0">
            <p className="text-caption font-medium text-[var(--text-tertiary)] flex items-center gap-1.5">
              <Search className="h-3 w-3" /> Filters
              {activeFilters > 0 && <span className="text-[var(--indigo-text)] tabular">· {activeFilters}</span>}
            </p>
            <span className="flex items-center gap-3">
              <button
                onClick={() => setOpenRows(allOpen ? new Set(DEFAULT_OPEN_ROWS) : new Set(ALL_ROWS))}
                className="text-caption font-medium text-[var(--text-tertiary)] hover:text-[var(--indigo-text)] transition-colors"
              >
                {allOpen ? 'Collapse' : 'Show every filter'}
              </button>
              {hasFilters && (
                <button
                  onClick={() => setForm(EMPTY_FILTERS)}
                  className="text-caption font-medium text-[var(--text-tertiary)] hover:text-[var(--indigo-text)] transition-colors"
                >
                  Clear all
                </button>
              )}
            </span>
          </div>

          <div className="pb-2 border-t border-[var(--border-subtle)] lg:overflow-y-auto lg:min-h-0 lg:flex-1 [scrollbar-width:thin]">
            <FilterPanel value={form} onChange={setForm} full={fullFilters} onSubmit={() => runSearch(1)} openRows={openRows} onToggleRow={toggleRow} />
          </div>

          {/* Stays in reach however far down the filters go. */}
          <div className="sticky bottom-0 lg:static flex-shrink-0 rounded-b-xl border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-2">
            {fullFilters && hasFilters && (
              <div className="text-caption text-[var(--text-tertiary)] tabular flex items-center gap-1.5" aria-live="polite">
                {matchCount !== null ? (
                  <><span className="text-strong font-semibold text-[var(--text-primary)]">{matchCount.toLocaleString()}</span> {matchCount === 1 ? 'person matches' : 'people match'}</>
                ) : counting ? 'Counting matches…' : 'Search to see matches'}
                {counting && matchCount !== null && <Spinner size="sm" />}
              </div>
            )}
            <Button className="w-full" onClick={() => runSearch(1)} disabled={!providerReady || searchMutation.isPending}>
              {searchMutation.isPending ? <><Spinner size="sm" /> Searching…</> : <><Search className="h-3.5 w-3.5" /> Search prospects</>}
            </Button>
            {/* The same search, working every day without you. */}
            <button
              type="button"
              onClick={() => setSaveRuleOpen(true)}
              disabled={!hasFilters || !providerReady}
              className="w-full inline-flex items-center justify-center gap-1.5 h-8 rounded-lg border border-dashed border-[var(--border-default)] text-caption font-medium text-[var(--text-secondary)] hover:text-[var(--indigo-text)] hover:border-[var(--indigo)]/40 disabled:opacity-40 transition-colors"
              title="Reveal, verify and enrol new matches automatically"
            >
              <Radar className="h-3.5 w-3.5" /> Keep this search running
            </button>
            <SaveStandingSearch filters={filters} open={saveRuleOpen} onClose={() => setSaveRuleOpen(false)} />
          </div>
        </div>

        {/* Results */}
        <div className="min-w-0 space-y-3">
          <StandingSearches />
          {/* Where saved leads go, and the campaigns that list feeds. */}
          <DestinationPicker listId={listId} onChange={setListId} />
          {results && (
            <p className="text-body text-[var(--text-tertiary)] tabular text-right">
              {results.total.toLocaleString()} match{results.total === 1 ? '' : 'es'}
            </p>
          )}

          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2.5 mb-3 rounded-lg border border-[var(--indigo)]/25 bg-[var(--indigo-subtle)] px-3 py-2">
              <span className="text-body font-medium text-[var(--text-primary)]">{selectedIds.size} selected</span>
              <span className="flex-1" />
              <Button size="sm" variant="secondary" onClick={() => setSelectedIds(new Set())} disabled={bulkRevealing}>
                Clear
              </Button>
              <Button
                size="sm"
                onClick={bulkReveal}
                disabled={bulkRevealing || revealingId !== null || (credits ? credits.remaining === 0 : false)}
              >
                {bulkRevealing
                  ? <><Spinner size="sm" /> Revealing…</>
                  : <><Unlock className="h-3 w-3" /> Reveal {selectedIds.size} selected</>}
              </Button>
            </div>
          )}

          {!results ? (
            <div className="rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--bg-surface)] py-20 text-center px-6">
              <Radar className="h-8 w-8 text-[var(--text-tertiary)] mx-auto mb-3" />
              <p className="text-heading font-semibold text-[var(--text-primary)]">Find your next customers</p>
              <p className="text-body text-[var(--text-tertiary)] mt-1 max-w-md mx-auto">
                Stack as many filters as you like: towns, regions, whole markets, titles, skills, past employers. The match count updates as you go. Each verified email you reveal costs 1 credit and lands in your lead lists, ready for campaigns.
              </p>
            </div>
          ) : results.results.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="No prospects match those filters"
              description="Try broadening the title or removing a filter."
            />
          ) : (() => {
            const unrevealedOnPage = results.results.filter((p) => !p.already_revealed).map((p) => p.id);
            const allSelected = unrevealedOnPage.length > 0 && unrevealedOnPage.every((id) => selectedIds.has(id));
            return (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-caption font-medium text-[var(--text-tertiary)]">
                      <th className="py-2.5 pl-4 pr-2 w-8">
                        {unrevealedOnPage.length > 0 && (
                          <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={() => setSelectedIds((prev) => {
                              if (allSelected) {
                                const next = new Set(prev);
                                unrevealedOnPage.forEach((id) => next.delete(id));
                                return next;
                              }
                              return new Set([...prev, ...unrevealedOnPage]);
                            })}
                            aria-label="Select all unrevealed prospects on this page"
                            className="h-3.5 w-3.5 rounded border-[var(--border-default)]"
                          />
                        )}
                      </th>
                      <th className="py-2.5 pr-3">Person</th>
                      <th className="py-2.5 px-3">Company</th>
                      <th className="py-2.5 px-3">Location</th>
                      <th className="py-2.5 px-3">Email</th>
                      <th className="py-2.5 pr-4 pl-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.results.map((p) => (
                      <tr key={p.id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-hover)] transition-colors">
                        <td className="py-2.5 pl-4 pr-2 w-8">
                          {!p.already_revealed && (
                            <input
                              type="checkbox"
                              checked={selectedIds.has(p.id)}
                              onChange={() => toggleSelect(p.id)}
                              aria-label={`Select ${p.full_name}`}
                              className="h-3.5 w-3.5 rounded border-[var(--border-default)]"
                            />
                          )}
                        </td>
                        <td className="py-2.5 pr-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Avatar name={p.full_name} size="lg" />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-strong font-medium text-[var(--text-primary)] truncate">{p.full_name}</span>
                                {p.linkedin_url && (
                                  <a href={p.linkedin_url} target="_blank" rel="noopener noreferrer" className="relative text-[var(--text-tertiary)] hover:text-[#0A66C2] transition-colors flex-shrink-0 after:absolute after:-inset-1.5 after:content-['']" title="Open LinkedIn" aria-label="Open LinkedIn">
                                    <Linkedin className="h-3 w-3" />
                                  </a>
                                )}
                              </div>
                              <p className="text-caption text-[var(--text-tertiary)] truncate">{p.job_title || '—'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <p className="text-body text-[var(--text-primary)] truncate max-w-[180px]">{p.company || '—'}</p>
                          <p className="text-caption text-[var(--text-tertiary)] truncate">{[p.industry, p.company_size && `${p.company_size} people`].filter(Boolean).join(' · ')}</p>
                        </td>
                        <td className="py-2.5 px-3 text-body text-[var(--text-secondary)] truncate max-w-[150px]">{p.location || '—'}</td>
                        <td className="py-2.5 px-3">
                          {p.already_revealed ? (
                            <span className="inline-flex items-center gap-1 text-caption font-medium text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="h-3 w-3" /> Unlocked
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-body text-[var(--text-tertiary)] font-mono select-none">
                              <Lock className="h-3 w-3" /> ●●●●●@{p.company_domain || '●●●●●.com'}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-4 pl-3">
                          <div className="flex justify-end">
                            {p.already_revealed && p.contact_id ? (
                              <span className="inline-flex items-center gap-0.5">
                                <button
                                  onClick={() => setCampaignContactIds([p.contact_id!])}
                                  className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-body font-medium text-[var(--indigo-text)] hover:bg-[var(--indigo-subtle)] transition-colors"
                                  title="Add this lead to a campaign"
                                >
                                  <Megaphone className="h-3 w-3" /> Campaign
                                </button>
                                <button
                                  onClick={() => navigate(`/contacts/${p.contact_id}`)}
                                  className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-body font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                                >
                                  Open <ArrowUpRight className="h-3 w-3" />
                                </button>
                              </span>
                            ) : (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => revealMutation.mutate(p)}
                                disabled={revealingId !== null || bulkRevealing || (credits ? credits.remaining === 0 : false)}
                              >
                                {revealingId === p.id
                                  ? <><Spinner size="sm" /> Revealing…</>
                                  : <><Unlock className="h-3 w-3" /> Reveal · 1 credit</>}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between px-4 h-11 border-t border-[var(--border-subtle)]">
                <span className="text-caption text-[var(--text-tertiary)] tabular">Page {page} of {totalPages}</span>
                <div className="flex items-center gap-1">
                  <button aria-label="Previous page" onClick={() => runSearch(page - 1)} disabled={page <= 1 || searchMutation.isPending} className="icon-btn h-7 w-7 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                  <button aria-label="Next page" onClick={() => runSearch(page + 1)} disabled={page >= totalPages || searchMutation.isPending} className="icon-btn h-7 w-7 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
                </div>
              </div>
            </div>
            );
          })()}

          {/* Out of credits nudge */}
          {credits && credits.allowance >= 0 && credits.remaining === 0 && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2.5 flex-wrap shadow-[inset_3px_0_0_theme(colors.amber.500)]">
              <span className="text-body text-[var(--text-secondary)] flex items-center gap-2">
                <Coins className="h-3.5 w-3.5 text-amber-500" /> You're out of credits. Plan credits reset {formatDayMonth(new Date(credits.resets_at))}.
              </span>
              <span className="flex items-center gap-3 flex-shrink-0">
                <button onClick={() => setBuyOpen(true)} className="inline-flex items-center gap-1 text-body font-semibold text-[var(--indigo-text)] hover:underline">
                  <Plus className="h-3 w-3" /> Buy credits
                </button>
                <Link to="/billing" className="text-body font-medium text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
                  or upgrade plan
                </Link>
              </span>
            </div>
          )}
        </div>
      </div>
      )}

      {buyOpen && <BuyCreditsModal onClose={() => setBuyOpen(false)} />}
      {campaignContactIds && <AddToCampaignModal contactIds={campaignContactIds} onClose={() => setCampaignContactIds(null)} />}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { prospectingApi } from '../../api/prospecting.api';
import { listsApi } from '../../api/contacts.api';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import { Avatar } from '../../components/shared/Avatar';
import { cn } from '../../lib/utils';
import {
  Radar, Search, MapPin, Building2, Briefcase, Users, Sparkles,
  Lock, Unlock, CheckCircle2, ChevronLeft, ChevronRight, X,
  Linkedin, ArrowUpRight, Coins, KeyRound, FolderOpen, Plus,
} from 'lucide-react';
import { CREDIT_PACKS } from '@lemlist/shared';
import type {
  ProspectPerson, ProspectSearchFilters, ProspectSearchResponse,
} from '@lemlist/shared';

const SENIORITIES = [
  { value: 'owner', label: 'Owner' },
  { value: 'c_suite', label: 'C-Suite' },
  { value: 'vp', label: 'VP' },
  { value: 'director', label: 'Director' },
  { value: 'manager', label: 'Manager' },
  { value: 'senior', label: 'Senior' },
  { value: 'entry', label: 'Entry' },
];
const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001-10000'];

/** Comma/enter separated chip input for multi-value filters. */
function ChipInput({
  label, icon: Icon, values, onChange, placeholder,
}: {
  label: string;
  icon: typeof Search;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const parts = draft.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...new Set([...values, ...parts])]);
    setDraft('');
  };
  return (
    <div>
      <label className="flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--text-secondary)] mb-1">
        <Icon className="h-3 w-3 text-[var(--text-muted)]" /> {label}
      </label>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); } }}
        onBlur={commit}
        placeholder={placeholder}
        className="block w-full h-8 rounded-md border border-[var(--border-default)] bg-[var(--bg-app)] px-2.5 text-[12.5px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] hover:border-[var(--border-strong)] focus:border-[var(--indigo)] focus:outline-none focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)] transition-[border-color,box-shadow]"
      />
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {values.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 pl-2 pr-1 h-[20px] rounded-[5px] bg-[var(--indigo-subtle)] text-[11px] font-medium text-[var(--indigo)]">
              {v}
              <button onClick={() => onChange(values.filter((x) => x !== v))} className="rounded hover:bg-[var(--indigo)]/15 p-0.5">
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function CreditsMeter({ allowance, planRemaining, purchased, onBuy }: {
  allowance: number; planRemaining: number; purchased: number; onBuy: () => void;
}) {
  if (allowance < 0) {
    return <span className="text-[12px] font-medium text-[var(--text-secondary)]">Unlimited credits</span>;
  }
  const pct = allowance > 0 ? Math.max(0, Math.min(100, (planRemaining / allowance) * 100)) : 0;
  const low = pct <= 15 && purchased === 0;
  return (
    <div className="flex items-center gap-2.5 flex-wrap">
      <Coins className={cn('h-4 w-4', low ? 'text-amber-500' : 'text-[var(--indigo)]')} />
      <div className="w-28 h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', low ? 'bg-amber-500' : '[background:var(--indigo-grad)]')} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[12px] font-medium text-[var(--text-primary)] tabular">
        {planRemaining}<span className="text-[var(--text-muted)]">/{allowance}</span>
        {purchased > 0 && <span className="text-[var(--indigo)]"> +{purchased.toLocaleString()}</span>}
        <span className="text-[var(--text-muted)]"> credits</span>
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
                <Coins className="h-4 w-4 text-[var(--indigo)]" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-[var(--text-primary)] tabular">
                  {pack.credits.toLocaleString()} credits
                  <span className="ml-2 inline-flex items-center px-1.5 h-[17px] text-[10px] font-medium bg-[var(--bg-elevated)] text-[var(--text-tertiary)] rounded-[4px]">{pack.label}</span>
                </p>
                <p className="text-[11px] text-[var(--text-tertiary)]">${perCredit.toFixed(3)} per lead</p>
              </div>
              <Button variant={pack.id === 'pack_2000' ? 'primary' : 'secondary'} disabled={busyId !== null} onClick={() => buy(pack.id)}>
                {busyId === pack.id ? 'Redirecting…' : `$${pack.priceUsd}`}
              </Button>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-[var(--text-muted)]">Secure checkout via Stripe. Credits appear within a few seconds of payment.</p>
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
  const [titles, setTitles] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);
  const [seniorities, setSeniorities] = useState<string[]>([]);
  const [companySizes, setCompanySizes] = useState<string[]>([]);
  const [keywords, setKeywords] = useState('');
  const [page, setPage] = useState(1);
  const [listId, setListId] = useState('');
  const [results, setResults] = useState<ProspectSearchResponse | null>(null);
  const [revealingId, setRevealingId] = useState<string | null>(null);

  const { data: status } = useQuery({ queryKey: ['prospecting', 'status'], queryFn: prospectingApi.status });
  const { data: lists } = useQuery({ queryKey: ['lists'], queryFn: listsApi.list });

  const filters: ProspectSearchFilters = {
    titles, locations, industries, companies, seniorities, companySizes,
    keywords: keywords.trim() || undefined,
  };
  const hasFilters = titles.length + locations.length + industries.length + companies.length + seniorities.length + companySizes.length > 0 || !!keywords.trim();

  const searchMutation = useMutation({
    mutationFn: ({ p }: { p: number }) => prospectingApi.search(filters, p),
    onSuccess: (data, vars) => { setResults(data); setPage(vars.p); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Search failed'),
  });

  const revealMutation = useMutation({
    mutationFn: (person: ProspectPerson) => prospectingApi.reveal({
      provider: person.provider,
      provider_person_id: person.id,
      person,
      list_id: listId || null,
    }),
    onMutate: (person) => setRevealingId(person.id),
    onSuccess: (res, person) => {
      qc.invalidateQueries({ queryKey: ['prospecting', 'status'] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
      if (res.found) {
        setResults((prev) => prev ? {
          ...prev,
          results: prev.results.map((r) => r.id === person.id ? { ...r, already_revealed: true, contact_id: res.contact_id } : r),
        } : prev);
        toast.success(res.already_revealed ? `Already unlocked: ${res.email}` : `Saved ${res.email} to your leads${listId ? ' list' : ''}`);
      } else {
        toast(`No verified email found for ${person.full_name} — you weren't charged.`, { icon: 'ℹ️' });
      }
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Reveal failed'),
    onSettled: () => setRevealingId(null),
  });

  const runSearch = (p = 1) => {
    if (!hasFilters) { toast('Add at least one filter to search.', { icon: '🔎' }); return; }
    searchMutation.mutate({ p });
  };

  const credits = status?.credits;
  const providerReady = !!status?.provider;
  const totalPages = results ? Math.max(1, Math.ceil(Math.min(results.total, 1000) / 25)) : 1;

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--indigo-subtle)]">
            <Radar className="h-5 w-5 text-[var(--indigo)]" />
          </span>
          <div>
            <h1 className="text-[19px] font-semibold text-[var(--text-primary)] tracking-[-0.01em]">Prospector</h1>
            <p className="text-[12.5px] text-[var(--text-tertiary)]">Search 100M+ B2B profiles, reveal verified emails, and drop them straight into your lead lists.</p>
          </div>
        </div>
        {credits && (
          <CreditsMeter
            allowance={credits.allowance}
            planRemaining={credits.plan_remaining}
            purchased={credits.purchased}
            onBuy={() => setBuyOpen(true)}
          />
        )}
      </div>

      {/* Provider not configured */}
      {status && !providerReady && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 mb-5 flex items-start gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 flex-shrink-0">
            <KeyRound className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </span>
          <div className="min-w-0 text-[12.5px]">
            <p className="font-medium text-[var(--text-primary)]">Connect a data provider to switch on the Prospector</p>
            <p className="text-[var(--text-secondary)] mt-0.5">
              Add a <code className="bg-[var(--bg-elevated)] px-1 py-0.5 rounded text-[11.5px]">PDL_API_KEY</code> (People Data Labs) or{' '}
              <code className="bg-[var(--bg-elevated)] px-1 py-0.5 rounded text-[11.5px]">APOLLO_API_KEY</code> to the server environment and restart.
              Search, credits, reveals and lead-list saving are already wired up — the key is the only missing piece.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 items-start">
        {/* Filters */}
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-3.5 lg:sticky lg:top-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
            <Search className="h-3 w-3" /> Filters
          </p>
          <ChipInput label="Job title" icon={Briefcase} values={titles} onChange={setTitles} placeholder="Head of Growth, CMO…" />
          <ChipInput label="Location" icon={MapPin} values={locations} onChange={setLocations} placeholder="London, United States…" />
          <ChipInput label="Industry" icon={Sparkles} values={industries} onChange={setIndustries} placeholder="SaaS, e-commerce…" />
          <ChipInput label="Company" icon={Building2} values={companies} onChange={setCompanies} placeholder="Name or domain…" />

          <div>
            <label className="flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--text-secondary)] mb-1">
              <Users className="h-3 w-3 text-[var(--text-muted)]" /> Seniority
            </label>
            <div className="flex flex-wrap gap-1">
              {SENIORITIES.map((s) => {
                const on = seniorities.includes(s.value);
                return (
                  <button
                    key={s.value}
                    onClick={() => setSeniorities(on ? seniorities.filter((x) => x !== s.value) : [...seniorities, s.value])}
                    className={cn(
                      'h-6 px-2 rounded-md text-[11px] font-medium border transition-colors',
                      on ? 'bg-[var(--indigo-subtle)] border-[rgba(91,91,245,0.3)] text-[var(--indigo)]' : 'border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:border-[var(--border-default)] hover:text-[var(--text-secondary)]'
                    )}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--text-secondary)] mb-1">
              <Building2 className="h-3 w-3 text-[var(--text-muted)]" /> Company size
            </label>
            <div className="flex flex-wrap gap-1">
              {COMPANY_SIZES.map((s) => {
                const on = companySizes.includes(s);
                return (
                  <button
                    key={s}
                    onClick={() => setCompanySizes(on ? companySizes.filter((x) => x !== s) : [...companySizes, s])}
                    className={cn(
                      'h-6 px-2 rounded-md text-[11px] font-medium border tabular transition-colors',
                      on ? 'bg-[var(--indigo-subtle)] border-[rgba(91,91,245,0.3)] text-[var(--indigo)]' : 'border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:border-[var(--border-default)] hover:text-[var(--text-secondary)]'
                    )}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-[11.5px] font-medium text-[var(--text-secondary)] mb-1 block">Keywords</label>
            <input
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') runSearch(1); }}
              placeholder="e.g. outbound, PLG, agency…"
              className="block w-full h-8 rounded-md border border-[var(--border-default)] bg-[var(--bg-app)] px-2.5 text-[12.5px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] hover:border-[var(--border-strong)] focus:border-[var(--indigo)] focus:outline-none focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)] transition-[border-color,box-shadow]"
            />
          </div>

          <Button className="w-full" onClick={() => runSearch(1)} disabled={!providerReady || searchMutation.isPending}>
            {searchMutation.isPending ? <><Spinner size="sm" /> Searching…</> : <><Search className="h-3.5 w-3.5" /> Search prospects</>}
          </Button>
        </div>

        {/* Results */}
        <div className="min-w-0">
          {/* Save-to-list bar */}
          <div className="flex items-center gap-2.5 mb-3 flex-wrap">
            <FolderOpen className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            <span className="text-[12px] text-[var(--text-secondary)]">Save revealed leads to</span>
            <div className="w-52">
              <Select
                options={[{ value: '', label: 'All contacts (no list)' }, ...(lists || []).map((l) => ({ value: l.id, label: l.name }))]}
                value={listId}
                onChange={(e) => setListId(e.target.value)}
              />
            </div>
            <span className="flex-1" />
            {results && (
              <span className="text-[12px] text-[var(--text-tertiary)] tabular">
                {results.total.toLocaleString()} match{results.total === 1 ? '' : 'es'}
              </span>
            )}
          </div>

          {!results ? (
            <div className="rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--bg-surface)] py-20 text-center px-6">
              <Radar className="h-8 w-8 text-[var(--text-muted)] mx-auto mb-3" />
              <p className="text-[14px] font-semibold text-[var(--text-primary)]">Find your next customers</p>
              <p className="text-[12.5px] text-[var(--text-tertiary)] mt-1 max-w-md mx-auto">
                Filter by job title, location, industry and company size. Each verified email you reveal costs 1 credit and lands in your lead lists — ready for campaigns.
              </p>
            </div>
          ) : results.results.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--bg-surface)] py-16 text-center">
              <p className="text-[13px] font-medium text-[var(--text-primary)]">No prospects match those filters</p>
              <p className="text-[12px] text-[var(--text-tertiary)] mt-1">Try broadening the title or removing a filter.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      <th className="py-2.5 pl-4 pr-3">Person</th>
                      <th className="py-2.5 px-3">Company</th>
                      <th className="py-2.5 px-3">Location</th>
                      <th className="py-2.5 px-3">Email</th>
                      <th className="py-2.5 pr-4 pl-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.results.map((p) => (
                      <tr key={p.id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-hover)] transition-colors">
                        <td className="py-2.5 pl-4 pr-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Avatar name={p.full_name} size="lg" />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">{p.full_name}</span>
                                {p.linkedin_url && (
                                  <a href={p.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-[var(--text-muted)] hover:text-[#0A66C2] transition-colors flex-shrink-0" title="Open LinkedIn">
                                    <Linkedin className="h-3 w-3" />
                                  </a>
                                )}
                              </div>
                              <p className="text-[11.5px] text-[var(--text-tertiary)] truncate">{p.job_title || '—'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <p className="text-[12.5px] text-[var(--text-primary)] truncate max-w-[180px]">{p.company || '—'}</p>
                          <p className="text-[11px] text-[var(--text-tertiary)] truncate">{[p.industry, p.company_size && `${p.company_size} people`].filter(Boolean).join(' · ')}</p>
                        </td>
                        <td className="py-2.5 px-3 text-[12px] text-[var(--text-secondary)] truncate max-w-[150px]">{p.location || '—'}</td>
                        <td className="py-2.5 px-3">
                          {p.already_revealed ? (
                            <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="h-3 w-3" /> Unlocked
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-muted)] font-mono select-none">
                              <Lock className="h-3 w-3" /> ●●●●●@{p.company_domain || '●●●●●.com'}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-4 pl-3">
                          <div className="flex justify-end">
                            {p.already_revealed && p.contact_id ? (
                              <button
                                onClick={() => navigate(`/contacts/${p.contact_id}`)}
                                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[12px] font-medium text-[var(--indigo)] hover:bg-[var(--indigo-subtle)] transition-colors"
                              >
                                Open lead <ArrowUpRight className="h-3 w-3" />
                              </button>
                            ) : (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => revealMutation.mutate(p)}
                                disabled={revealingId !== null || (credits ? credits.remaining === 0 : false)}
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
                <span className="text-[11.5px] text-[var(--text-tertiary)] tabular">Page {page} of {totalPages}</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => runSearch(page - 1)} disabled={page <= 1 || searchMutation.isPending} className="icon-btn h-7 w-7 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                  <button onClick={() => runSearch(page + 1)} disabled={page >= totalPages || searchMutation.isPending} className="icon-btn h-7 w-7 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
                </div>
              </div>
            </div>
          )}

          {/* Out of credits nudge */}
          {credits && credits.allowance >= 0 && credits.remaining === 0 && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-2.5 flex-wrap">
              <span className="text-[12.5px] text-[var(--text-secondary)] flex items-center gap-2">
                <Coins className="h-3.5 w-3.5 text-amber-500" /> You're out of credits. Plan credits reset {new Date(credits.resets_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.
              </span>
              <span className="flex items-center gap-3 flex-shrink-0">
                <button onClick={() => setBuyOpen(true)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--indigo)] hover:underline">
                  <Plus className="h-3 w-3" /> Buy credits
                </button>
                <Link to="/billing" className="text-[12px] font-medium text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
                  or upgrade plan
                </Link>
              </span>
            </div>
          )}
        </div>
      </div>

      {buyOpen && <BuyCreditsModal onClose={() => setBuyOpen(false)} />}
    </div>
  );
}

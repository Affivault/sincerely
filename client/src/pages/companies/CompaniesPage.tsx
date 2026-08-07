import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { companiesApi } from '../../api/companies.api';
import { PageHeader } from '../../components/shared/PageHeader';
import { EmptyState } from '../../components/shared/EmptyState';
import { SearchInput } from '../../components/shared/SearchInput';
import { Skeleton } from '../../components/ui/Skeleton';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { useDebounce } from '../../hooks/useDebounce';
import { usePeek } from '../../components/peek/usePeek';
import { cn } from '../../lib/utils';
import { Building2, Plus, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Company } from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Companies.

   Account-shaped view of the same data: who works where, what's open
   there, how much it's worth.

   Presented as a table, not a card grid. Every other list in this app is
   a dense sortable table, and a grid of cards here made the page read as
   if it came from a different product — cards also cost four times the
   height to say less, which is the wrong trade for a list you scan.
   ═══════════════════════════════════════════════════════════════════════ */

type SortKey = 'name' | 'contact_count' | 'deal_count' | 'open_value' | 'industry' | 'location';

function NewCompanyModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', domain: '', industry: '', location: '' });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => companiesApi.create({
      name: form.name.trim(),
      domain: form.domain.trim() || null,
      industry: form.industry.trim() || null,
      location: form.location.trim() || null,
    }),
    onSuccess: (company) => {
      qc.invalidateQueries({ queryKey: ['companies'] });
      // createOrGet is deliberately forgiving — say which happened.
      toast.success(`Saved ${company.name}`);
      onClose();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not save that'),
  });

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="New company"
      description="If this company already exists under a different spelling, you'll get that one back rather than a duplicate."
      size="md"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="company-form" disabled={!form.name.trim() || save.isPending}>
            {save.isPending ? 'Saving…' : 'Create'}
          </Button>
        </div>
      }
    >
      <form id="company-form" onSubmit={(e) => { e.preventDefault(); if (form.name.trim()) save.mutate(); }} className="space-y-3">
        <Input label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Acme" autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Domain" value={form.domain} onChange={(e) => set('domain', e.target.value)} placeholder="acme.com" />
          <Input label="Industry" value={form.industry} onChange={(e) => set('industry', e.target.value)} placeholder="Fintech" />
        </div>
        <Input label="Location" value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="London, UK" />
      </form>
    </Modal>
  );
}

function SortHeader({ label, colKey, sortBy, sortDir, onSort, align }: {
  label: string; colKey: SortKey; sortBy: SortKey; sortDir: 'asc' | 'desc';
  onSort: (k: SortKey) => void; align?: 'right';
}) {
  const active = sortBy === colKey;
  return (
    <button
      onClick={() => onSort(colKey)}
      className={cn(
        'flex items-center gap-1 group/sort transition-colors',
        align === 'right' && 'ml-auto flex-row-reverse',
        active ? 'text-[var(--indigo)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
      )}
    >
      <span className="text-[11px] font-medium">{label}</span>
      {active
        ? (sortDir === 'asc'
            ? <ChevronUp className="h-3 w-3 flex-shrink-0" />
            : <ChevronDown className="h-3 w-3 flex-shrink-0" />)
        : <ChevronsUpDown className="h-3 w-3 flex-shrink-0 opacity-0 group-hover/sort:opacity-60" />}
    </button>
  );
}

export function CompaniesPage() {
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 250);
  const [showNew, setShowNew] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const { openPeek } = usePeek();

  const { data: companies = [], isLoading, error } = useQuery({
    queryKey: ['companies', debounced],
    queryFn: () => companiesApi.list(debounced || undefined),
  });

  // The migration is opt-in, so a 503 here means "not set up yet", not broken.
  const needsMigration = (error as any)?.response?.status === 503;

  const handleSort = (k: SortKey) => {
    if (k === sortBy) { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); return; }
    setSortBy(k);
    // Names read best A–Z; counts and money read best biggest-first.
    setSortDir(k === 'name' || k === 'industry' || k === 'location' ? 'asc' : 'desc');
  };

  const rows = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...companies].sort((a: any, b: any) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      if (typeof av === 'number' || typeof bv === 'number') {
        return ((av ?? 0) - (bv ?? 0)) * dir;
      }
      // Blanks sort last whichever way the column is pointing — an empty
      // industry is never the answer to "sort by industry".
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [companies, sortBy, sortDir]);

  const totalOpen = useMemo(
    () => companies.reduce((s: number, c: any) => s + (Number(c.open_value) || 0), 0),
    [companies],
  );

  const money = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  return (
    <div>
      <PageHeader
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] border border-[rgba(99,102,241,0.18)]">
            <Building2 className="h-4 w-4 text-[var(--indigo)]" />
          </span>
        }
        title="Companies"
        description={
          companies.length > 0
            ? `${companies.length} account${companies.length === 1 ? '' : 's'}${totalOpen > 0 ? ` · ${money(totalOpen)} open` : ''}`
            : 'Accounts, their people, and the deals attached to them'
        }
        actions={
          <div className="flex items-center gap-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Search companies…" className="hidden sm:block w-56" />
            <button onClick={() => setShowNew(true)} className="btn-primary">
              <Plus className="h-3.5 w-3.5" /> New company
            </button>
          </div>
        }
      />

      {needsMigration ? (
        <div className="panel px-5 py-8 text-center">
          <Building2 className="h-6 w-6 mx-auto text-[var(--text-muted)] mb-2" />
          <p className="text-[14px] font-semibold text-[var(--text-primary)]">Companies aren't set up yet</p>
          <p className="text-[12.5px] text-[var(--text-tertiary)] mt-1 max-w-md mx-auto">
            Run migration <span className="font-mono text-[11.5px]">038_companies.sql</span> in Supabase, then
            preview the backfill before letting it group your existing contacts.
          </p>
        </div>
      ) : isLoading ? (
        <div className="panel p-3 space-y-1.5">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <Skeleton key={i} className="h-9 w-full" />)}
        </div>
      ) : companies.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={Building2}
            title={debounced ? `No companies match “${debounced}”` : 'No companies yet'}
            description={
              debounced
                ? 'Try a different name, domain or industry.'
                : "Companies group your contacts by where they work. Create one, or run the backfill to build them from the company names already on your contacts."
            }
            actionLabel="New company"
            onAction={() => setShowNew(true)}
          />
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-left">
              <thead>
                <tr>
                  <th className="bg-[var(--bg-muted)] border-b border-[var(--border-subtle)] px-3 py-[7px]">
                    <SortHeader label="Company" colKey="name" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="bg-[var(--bg-muted)] border-b border-[var(--border-subtle)] px-3 py-[7px] w-[92px]">
                    <SortHeader label="People" colKey="contact_count" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} align="right" />
                  </th>
                  <th className="bg-[var(--bg-muted)] border-b border-[var(--border-subtle)] px-3 py-[7px] w-[92px]">
                    <SortHeader label="Deals" colKey="deal_count" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} align="right" />
                  </th>
                  <th className="bg-[var(--bg-muted)] border-b border-[var(--border-subtle)] px-3 py-[7px] w-[120px]">
                    <SortHeader label="Open value" colKey="open_value" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} align="right" />
                  </th>
                  <th className="hidden md:table-cell bg-[var(--bg-muted)] border-b border-[var(--border-subtle)] px-3 py-[7px] w-[160px]">
                    <SortHeader label="Industry" colKey="industry" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="hidden lg:table-cell bg-[var(--bg-muted)] border-b border-[var(--border-subtle)] px-3 py-[7px] w-[180px]">
                    <SortHeader label="Location" colKey="location" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c: Company) => (
                  <tr
                    key={c.id}
                    onClick={() => openPeek('company', c.id)}
                    className="group cursor-pointer transition-colors hover:bg-[var(--bg-hover)]"
                  >
                    <td className="border-b border-[var(--border-subtle)] px-3 py-[7px]">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-[var(--bg-elevated)] text-[var(--text-tertiary)]">
                          <Building2 className="h-3 w-3" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[12.5px] font-medium text-[var(--text-primary)] truncate">{c.name}</span>
                          {c.domain && (
                            <span className="block text-[11px] text-[var(--text-tertiary)] truncate">{c.domain}</span>
                          )}
                        </span>
                      </div>
                    </td>
                    <td className="border-b border-[var(--border-subtle)] px-3 py-[7px] text-right text-[12.5px] tabular text-[var(--text-secondary)]">
                      {c.contact_count ?? 0}
                    </td>
                    <td className="border-b border-[var(--border-subtle)] px-3 py-[7px] text-right text-[12.5px] tabular text-[var(--text-secondary)]">
                      {c.deal_count ?? 0}
                    </td>
                    <td className={cn(
                      'border-b border-[var(--border-subtle)] px-3 py-[7px] text-right text-[12.5px] tabular',
                      c.open_value ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-muted)]',
                    )}>
                      {c.open_value ? money(c.open_value) : '—'}
                    </td>
                    <td className="hidden md:table-cell border-b border-[var(--border-subtle)] px-3 py-[7px] text-[12.5px] text-[var(--text-secondary)] truncate">
                      {c.industry || <span className="text-[var(--text-muted)]">—</span>}
                    </td>
                    <td className="hidden lg:table-cell border-b border-[var(--border-subtle)] px-3 py-[7px] text-[12.5px] text-[var(--text-secondary)] truncate">
                      {c.location || <span className="text-[var(--text-muted)]">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showNew && <NewCompanyModal onClose={() => setShowNew(false)} />}
    </div>
  );
}

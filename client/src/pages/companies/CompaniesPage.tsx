import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import { useColumnLayout, GUTTER_W } from '../../components/table/useColumnLayout';
import { SortableHeader, DraggableHeader, ResizeHandle } from '../../components/table/TableParts';
import { cn, formatDate } from '../../lib/utils';
import {
  Building2, Plus, Users, Handshake, Globe, MapPin, Factory,
  Linkedin, CircleDollarSign, CalendarPlus, ExternalLink,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { Company } from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Companies.

   Account-shaped view of the same data: who works where, what's open
   there, how much it's worth.

   Laid out as the contacts table, not as something that resembles it —
   the sizing, reordering and sort behaviour come from the same module, so
   the two pages can't drift into feeling like different products.
   ═══════════════════════════════════════════════════════════════════════ */

type SortKey =
  | 'name' | 'contact_count' | 'deal_count' | 'open_value'
  | 'industry' | 'location' | 'domain' | 'size' | 'created_at';

const NAME_COL_ID = '__company__';
const NAME_COL_W = 260;
const ACTIONS_W = 60;

interface ColumnDef {
  id: string;
  label: string;
  icon?: React.ElementType;
  sortKey?: SortKey;
  align?: 'right';
  render: (c: any) => React.ReactNode;
}

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const blank = <span className="text-[var(--text-muted)]">—</span>;

const ALL_COLUMNS: ColumnDef[] = [
  {
    id: 'contact_count', label: 'People', icon: Users, sortKey: 'contact_count', align: 'right',
    render: (c) => <span className="tabular">{c.contact_count ?? 0}</span>,
  },
  {
    id: 'deal_count', label: 'Deals', icon: Handshake, sortKey: 'deal_count', align: 'right',
    render: (c) => <span className="tabular">{c.deal_count ?? 0}</span>,
  },
  {
    id: 'open_value', label: 'Open value', icon: CircleDollarSign, sortKey: 'open_value', align: 'right',
    render: (c) => (c.open_value
      ? <span className="tabular font-medium text-[var(--text-primary)]">{money(c.open_value)}</span>
      : blank),
  },
  {
    id: 'industry', label: 'Industry', icon: Factory, sortKey: 'industry',
    render: (c) => c.industry || blank,
  },
  {
    id: 'location', label: 'Location', icon: MapPin, sortKey: 'location',
    render: (c) => c.location || blank,
  },
  {
    id: 'domain', label: 'Domain', icon: Globe, sortKey: 'domain',
    render: (c) => (c.domain
      ? (
        <a
          href={c.website || `https://${c.domain}`}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 hover:text-[var(--indigo)] hover:underline truncate"
        >
          {c.domain}
        </a>
      )
      : blank),
  },
  {
    id: 'size', label: 'Headcount', icon: Users, sortKey: 'size',
    render: (c) => c.size || blank,
  },
  {
    id: 'linkedin_url', label: 'LinkedIn', icon: Linkedin,
    render: (c) => (c.linkedin_url
      ? (
        <a
          href={c.linkedin_url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 hover:text-[var(--indigo)] hover:underline"
        >
          Profile <ExternalLink className="h-3 w-3" />
        </a>
      )
      : blank),
  },
  {
    id: 'created_at', label: 'Added', icon: CalendarPlus, sortKey: 'created_at',
    render: (c) => <span className="tabular">{formatDate(c.created_at)}</span>,
  },
];

const DEFAULT_COLUMNS = ['contact_count', 'deal_count', 'open_value', 'industry', 'location', 'domain'];

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

export function CompaniesPage() {
  // ?q= lets other pages deep-link here — a deal card whose company isn't
  // linked to a record yet sends you to the accounts list filtered by name.
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(() => params.get('q') || '');
  const debounced = useDebounce(search, 250);

  const onSearch = (v: string) => {
    setSearch(v);
    const next = new URLSearchParams(params);
    if (v) next.set('q', v); else next.delete('q');
    setParams(next, { replace: true });
  };
  const [showNew, setShowNew] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const { openPeek } = usePeek();

  const layout = useColumnLayout({
    storagePrefix: 'companies',
    defaultOrder: DEFAULT_COLUMNS,
    widthOverrides: {
      [NAME_COL_ID]: NAME_COL_W,
      open_value: 130, contact_count: 100, deal_count: 100, created_at: 130,
    },
  });

  const { data: companies = [], isLoading, error } = useQuery({
    queryKey: ['companies', debounced],
    queryFn: () => companiesApi.list(debounced || undefined),
  });

  // The migration is opt-in, so a 503 here means "not set up yet", not broken.
  const needsMigration = (error as any)?.response?.status === 503;

  const columns = layout.order
    .map((id) => ALL_COLUMNS.find((c) => c.id === id))
    .filter(Boolean) as ColumnDef[];

  const handleSort = (k: SortKey) => {
    if (k === sortBy) { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); return; }
    setSortBy(k);
    // Counts and money read best biggest-first; names and places A–Z.
    const numeric = k === 'contact_count' || k === 'deal_count' || k === 'open_value' || k === 'created_at';
    setSortDir(numeric ? 'desc' : 'asc');
  };

  const rows = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...companies].sort((a: any, b: any) => {
      if (sortBy === 'created_at') {
        return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
      }
      const av = a[sortBy];
      const bv = b[sortBy];
      if (typeof av === 'number' || typeof bv === 'number') return ((av ?? 0) - (bv ?? 0)) * dir;
      // Blanks sort last whichever way the column points — an empty industry
      // is never the answer to "sort by industry".
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

  const tableMinWidth =
    GUTTER_W + layout.widthOf(NAME_COL_ID) + columns.reduce((n, c) => n + layout.widthOf(c.id), 0) + ACTIONS_W;

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
            <SearchInput value={search} onChange={onSearch} placeholder="Search companies…" className="hidden sm:block w-56" />
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
            <table
              className="border-separate border-spacing-0 text-left table-fixed w-full"
              style={{ minWidth: tableMinWidth }}
            >
              <colgroup>
                <col style={{ width: GUTTER_W }} />
                <col style={{ width: layout.widthOf(NAME_COL_ID) }} />
                {columns.map((col) => <col key={col.id} style={{ width: layout.widthOf(col.id) }} />)}
                {/* Filler — soaks up slack so the set widths stay exact */}
                <col />
                <col style={{ width: ACTIONS_W }} />
              </colgroup>

              <thead>
                <tr>
                  <th className="sticky left-0 z-[3] bg-[var(--bg-muted)] border-b border-[var(--border-subtle)] pl-3 pr-2 py-[7px]" />
                  <th className="relative sticky left-[44px] z-[3] bg-[var(--bg-muted)] border-b border-[var(--border-subtle)] px-3 py-[7px] shadow-[inset_-1px_0_0_var(--border-subtle)]">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <Building2 className="h-3 w-3 flex-shrink-0 text-[var(--text-muted)]" strokeWidth={1.9} />
                      <SortableHeader label="Company" colKey="name" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                    </span>
                    <ResizeHandle
                      onPointerDown={(e) => layout.startResize(NAME_COL_ID, e)}
                      onDoubleClick={() => layout.resetWidth(NAME_COL_ID)}
                    />
                  </th>

                  {columns.map((col) => (
                    <DraggableHeader key={col.id} id={col.id} layout={layout}>
                      {col.icon && <col.icon className="h-3 w-3 flex-shrink-0 text-[var(--text-muted)]" strokeWidth={1.9} />}
                      {col.sortKey
                        ? <SortableHeader label={col.label} colKey={col.sortKey} sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                        : <span className="text-[11px] font-medium text-[var(--text-tertiary)] truncate">{col.label}</span>}
                    </DraggableHeader>
                  ))}

                  <th className="bg-[var(--bg-muted)] border-b border-[var(--border-subtle)]" />
                  <th className="sticky right-0 z-[3] bg-[var(--bg-muted)] border-b border-[var(--border-subtle)] px-2 py-2 shadow-[inset_1px_0_0_var(--border-subtle)]" />
                </tr>
              </thead>

              <tbody>
                {rows.map((c: Company, rowIdx: number) => (
                  <tr
                    key={c.id}
                    onClick={() => openPeek('company', c.id)}
                    className="group cursor-pointer transition-colors duration-150 hover:bg-[var(--bg-hover)]"
                  >
                    <td className="sticky left-0 z-[1] bg-[var(--bg-surface)] group-hover:bg-[var(--bg-hover)] pl-3 pr-2 py-1.5 border-b border-[var(--border-subtle)]">
                      <span className="text-[10.5px] tabular text-[var(--text-muted)] select-none">{rowIdx + 1}</span>
                    </td>

                    <td className="sticky left-[44px] z-[1] bg-[var(--bg-surface)] group-hover:bg-[var(--bg-hover)] px-3 py-1.5 border-b border-[var(--border-subtle)] shadow-[inset_-1px_0_0_var(--border-subtle)]">
                      <span className="flex items-center gap-2.5 min-w-0">
                        <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-[var(--bg-elevated)] text-[var(--text-tertiary)]">
                          <Building2 className="h-3 w-3" />
                        </span>
                        <span className="text-[12.5px] font-medium text-[var(--text-primary)] truncate">{c.name}</span>
                      </span>
                    </td>

                    {columns.map((col) => (
                      <td
                        key={col.id}
                        className={cn(
                          'px-3 py-1.5 border-b border-[var(--border-subtle)] text-[12.5px] text-[var(--text-secondary)] truncate',
                          col.align === 'right' && 'text-right',
                        )}
                      >
                        {col.render(c)}
                      </td>
                    ))}

                    <td className="border-b border-[var(--border-subtle)]" />
                    <td className="sticky right-0 z-[1] bg-[var(--bg-surface)] group-hover:bg-[var(--bg-hover)] px-2 py-1.5 border-b border-[var(--border-subtle)] shadow-[inset_1px_0_0_var(--border-subtle)] text-right">
                      <span className="text-[11px] font-medium text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity">
                        Open
                      </span>
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

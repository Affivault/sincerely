import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import {
  ENGAGEMENT_STEPS, PERSON_FILTER_FIELDS, sanitizePersonFilters,
  type PersonFilterKey, type PersonFilters,
} from '@lemlist/shared';
import { contactsApi } from '../../api/contacts.api';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   Filters: country, region, city, industry, company size and industry,
   and how engaged they are.

   One button beside Company. The menu lists each field with the values
   people on this page actually have, commonest first with counts, so
   "United Kingdom (412)" is a click rather than a guess at spelling; a
   value that is not in the list can still be typed. Active filters show
   as chips with the others above the table, and are saved with a view.
   ═══════════════════════════════════════════════════════════════════════ */

type TextKey = Exclude<PersonFilterKey, 'engagement_min'>;

export function PersonFiltersMenu({ value, onChange, lifecycle }: {
  value: PersonFilters;
  onChange: (next: PersonFilters) => void;
  lifecycle: string;
}) {
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<TextKey | 'engagement_min'>('country');
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const { data: facets, isLoading } = useQuery({
    queryKey: ['contact-facets', lifecycle],
    queryFn: () => contactsApi.facets(lifecycle),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc, true); };
  }, [open]);
  useEffect(() => { setQ(''); }, [field]);

  const active = sanitizePersonFilters(value);
  const count = Object.keys(active).length;

  const set = (k: PersonFilterKey, v: string | number | undefined) => {
    const next: PersonFilters = { ...active };
    if (v === undefined || v === '' || (k !== 'engagement_min' && (next as any)[k] === v)) delete (next as any)[k];
    else (next as any)[k] = v;
    onChange(next);
  };

  const values = useMemo(() => {
    if (field === 'engagement_min') return [];
    const all = facets?.[field] || [];
    const term = q.trim().toLowerCase();
    return term ? all.filter((f) => f.value.toLowerCase().includes(term)) : all;
  }, [facets, field, q]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn('btn-secondary', count > 0 && 'border-[var(--indigo)]/50 text-[var(--indigo-text)]')}
        data-person-filters
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Filters
        {count > 0 && <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md bg-[var(--indigo)] px-1 text-micro font-semibold text-white tabular">{count}</span>}
        <ChevronDown className={cn('h-3 w-3 opacity-60 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div role="dialog" aria-label="Filters" className="absolute left-0 top-full z-50 mt-1.5 w-[min(560px,calc(100vw-32px))] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-xl)] animate-fade-in">
          <div className="grid grid-cols-[180px_1fr] min-h-[300px]">
            {/* Fields */}
            <nav className="border-r border-[var(--border-subtle)] p-1.5 space-y-0.5" aria-label="Filter by">
              {(['Person', 'Company'] as const).map((g) => (
                <div key={g}>
                  <p className="px-2 pt-2 pb-1 text-micro font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">{g}</p>
                  {PERSON_FILTER_FIELDS.filter((f) => f.group === g).map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setField(f.key)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-md px-2 h-8 text-left text-body transition-colors',
                        field === f.key ? 'bg-[var(--bg-active)] font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
                      )}
                    >
                      <span className="truncate">{f.label}</span>
                      {active[f.key] && <span className="h-1.5 w-1.5 rounded-full bg-[var(--indigo)] flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              ))}
              <p className="px-2 pt-2 pb-1 text-micro font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">Activity</p>
              <button
                type="button"
                onClick={() => setField('engagement_min')}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-md px-2 h-8 text-left text-body transition-colors',
                  field === 'engagement_min' ? 'bg-[var(--bg-active)] font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
                )}
              >
                Engagement
                {active.engagement_min && <span className="h-1.5 w-1.5 rounded-full bg-[var(--indigo)]" />}
              </button>
            </nav>

            {/* Values */}
            <div className="flex flex-col min-w-0">
              {field === 'engagement_min' ? (
                <div className="p-3 space-y-1">
                  <p className="text-caption text-[var(--text-tertiary)] mb-2">How warm they are, from replies, meetings, clicks and opens (0-100).</p>
                  {[undefined, ...ENGAGEMENT_STEPS].map((n) => (
                    <button
                      key={n ?? 'any'}
                      type="button"
                      onClick={() => set('engagement_min', n)}
                      className={cn('flex w-full items-center justify-between rounded-md px-2.5 h-8 text-body transition-colors hover:bg-[var(--bg-hover)]',
                        (active.engagement_min ?? undefined) === n ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]')}
                    >
                      {n ? `${n} or more` : 'Any engagement'}
                      {(active.engagement_min ?? undefined) === n && <Check className="h-3.5 w-3.5 text-[var(--indigo-text)]" />}
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  <div className="relative p-2 border-b border-[var(--border-subtle)]">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                    <input
                      autoFocus
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) { set(field, q.trim()); setQ(''); } }}
                      placeholder={`Find or type a ${PERSON_FILTER_FIELDS.find((f) => f.key === field)?.label.toLowerCase()}`}
                      aria-label="Find a value"
                      className="w-full h-8 pl-8 pr-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-body text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--indigo)]"
                    />
                  </div>
                  <div className="flex-1 overflow-y-auto max-h-[280px] p-1.5">
                    {isLoading ? (
                      <p className="px-2 py-6 text-center text-caption text-[var(--text-tertiary)]">Loading values...</p>
                    ) : values.length === 0 ? (
                      <div className="px-2 py-6 text-center">
                        <p className="text-caption text-[var(--text-tertiary)]">{q ? 'No one has that value yet.' : 'Nobody here has this filled in yet.'}</p>
                        {q.trim() && (
                          <button type="button" onClick={() => { set(field, q.trim()); setQ(''); }} className="btn-secondary mt-2 h-7">Filter by "{q.trim()}"</button>
                        )}
                      </div>
                    ) : values.map((v) => {
                      const on = (active[field] || '').toLowerCase() === v.value.toLowerCase();
                      return (
                        <button
                          key={v.value}
                          type="button"
                          onClick={() => set(field, on ? undefined : v.value)}
                          className={cn('flex w-full items-center gap-2 rounded-md px-2.5 h-8 text-left text-body transition-colors hover:bg-[var(--bg-hover)]',
                            on ? 'font-semibold text-[var(--text-primary)] bg-[var(--indigo-subtle)]' : 'text-[var(--text-secondary)]')}
                        >
                          <span className="flex-1 truncate">{v.value}</span>
                          <span className="text-caption tabular text-[var(--text-tertiary)]">{v.count.toLocaleString()}</span>
                          {on && <Check className="h-3.5 w-3.5 text-[var(--indigo-text)]" />}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
          {count > 0 && (
            <div className="flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-3 py-2">
              <span className="text-caption text-[var(--text-tertiary)]">{count} filter{count === 1 ? '' : 's'} on</span>
              <button type="button" onClick={() => onChange({})} className="inline-flex items-center gap-1 text-caption font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                <X className="h-3 w-3" /> Clear these filters
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

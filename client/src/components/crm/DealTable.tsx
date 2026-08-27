import { useMemo, useState } from 'react';
import { DEAL_STAGES, probabilityOf, rotOf, weightedValue } from '@lemlist/shared';
import type { Deal, DealStage } from '@lemlist/shared';
import { Avatar } from '../shared/Avatar';
import { Checkbox } from '../ui/Checkbox';
import { cn } from '../../lib/utils';
import { ArrowDown, ArrowUp, Building2, Clock } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════════
   The pipeline as a table.

   A board is the right shape for working a deal and the wrong shape for
   looking at forty of them. You cannot sort a board, you cannot compare
   down a column, and past about thirty cards the thing you are looking for
   is always in the column you have scrolled away from.

   Every serious CRM ships both, and this is the half that was missing.
   ═══════════════════════════════════════════════════════════════════════ */

export type SortKey = 'title' | 'company' | 'value' | 'weighted' | 'stage' | 'close' | 'age' | 'lead';
export type SortDir = 'asc' | 'desc';

function money(v: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency, maximumFractionDigits: 0,
    }).format(v || 0);
  } catch {
    return `$${Math.round(v || 0).toLocaleString()}`;
  }
}

const STAGE_DOT: Record<DealStage, string> = {
  lead: 'bg-slate-400',
  qualified: 'bg-[var(--indigo)]',
  proposal: 'bg-amber-500',
  won: 'bg-emerald-500',
  lost: 'bg-rose-500',
};

function leadName(d: Deal): string | null {
  if (d.contact) {
    const n = [d.contact.first_name, d.contact.last_name].filter(Boolean).join(' ');
    if (n) return n;
  }
  return d.contact_name || d.contact?.email || d.contact_email || null;
}
function leadEmail(d: Deal): string | null {
  return d.contact?.email || d.contact_email || null;
}

/** Close date as a short label plus how it should read. */
function closeLabel(iso: string | null, stage: DealStage): { text: string; tone: string } {
  if (!iso) return { text: '—', tone: 'text-[var(--text-muted)]' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { text: '—', tone: 'text-[var(--text-muted)]' };
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(d) - startOf(new Date())) / 86_400_000);
  const text = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  // A date in the past only matters while the deal is still open; on a closed
  // deal it is just a record of what was expected.
  const live = stage !== 'won' && stage !== 'lost';
  if (live && diff < 0) return { text: `${text} · ${Math.abs(diff)}d late`, tone: 'text-rose-500 font-medium' };
  if (live && diff <= 7) return { text, tone: 'text-amber-600 dark:text-amber-400' };
  return { text, tone: 'text-[var(--text-secondary)]' };
}

function sortValue(d: Deal, key: SortKey): string | number {
  switch (key) {
    case 'title': return (d.title || '').toLowerCase();
    case 'company': return (d.company || '').toLowerCase();
    case 'value': return Number(d.value) || 0;
    case 'weighted': return weightedValue(d);
    case 'stage': return DEAL_STAGES.findIndex((s) => s.id === d.stage);
    case 'lead': return (leadName(d) || '').toLowerCase();
    case 'age': return rotOf(d).days ?? -1;
    case 'close':
      // Deals with no close date sort last in either direction rather than
      // clumping at the top as epoch zero and burying everything real.
      return d.expected_close_date ? new Date(d.expected_close_date).getTime() : Number.MAX_SAFE_INTEGER;
    default: return 0;
  }
}

export function sortDeals(deals: Deal[], key: SortKey, dir: SortDir): Deal[] {
  const factor = dir === 'asc' ? 1 : -1;
  return [...deals].sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    if (av === bv) return (a.title || '').localeCompare(b.title || '');
    return (av > bv ? 1 : -1) * factor;
  });
}

function Th({
  label, sortKey, active, dir, onSort, align = 'left', width,
}: {
  label: string;
  sortKey?: SortKey;
  active?: SortKey;
  dir?: SortDir;
  onSort?: (k: SortKey) => void;
  align?: 'left' | 'right';
  width?: string;
}) {
  const on = sortKey && active === sortKey;
  return (
    <th
      style={width ? { width } : undefined}
      className={cn(
        'sticky top-0 z-10 bg-[var(--bg-surface)] px-3 py-2 text-[11px] font-semibold uppercase tracking-wider',
        'border-b border-[var(--border-subtle)] text-[var(--text-tertiary)]',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {sortKey && onSort ? (
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className={cn(
            'inline-flex items-center gap-1 transition-colors hover:text-[var(--text-primary)]',
            on && 'text-[var(--text-primary)]',
          )}
        >
          {label}
          {on && (dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
        </button>
      ) : (
        label
      )}
    </th>
  );
}

export function DealTable({
  deals,
  sortKey,
  sortDir,
  onSort,
  selected,
  onToggle,
  onToggleAll,
  onOpen,
  onOpenCompany,
  onOpenLead,
  onStageChange,
  currency = 'USD',
}: {
  deals: Deal[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onOpen: (d: Deal) => void;
  onOpenCompany: (d: Deal) => void;
  onOpenLead: (d: Deal) => void;
  onStageChange: (d: Deal, stage: DealStage) => void;
  currency?: string;
}) {
  const rows = useMemo(() => sortDeals(deals, sortKey, sortDir), [deals, sortKey, sortDir]);
  const allOn = rows.length > 0 && rows.every((d) => selected.has(d.id));

  return (
    <div className="panel overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse">
          <thead>
            <tr>
              <th className="sticky top-0 z-10 w-9 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
                <Checkbox checked={allOn} onChange={onToggleAll} aria-label="Select every deal shown" />
              </th>
              <Th label="Deal" sortKey="title" active={sortKey} dir={sortDir} onSort={onSort} />
              <Th label="Company" sortKey="company" active={sortKey} dir={sortDir} onSort={onSort} width="18%" />
              <Th label="Lead" sortKey="lead" active={sortKey} dir={sortDir} onSort={onSort} width="16%" />
              <Th label="Stage" sortKey="stage" active={sortKey} dir={sortDir} onSort={onSort} width="130px" />
              <Th label="Value" sortKey="value" active={sortKey} dir={sortDir} onSort={onSort} align="right" width="105px" />
              <Th label="Weighted" sortKey="weighted" active={sortKey} dir={sortDir} onSort={onSort} align="right" width="110px" />
              <Th label="Close" sortKey="close" active={sortKey} dir={sortDir} onSort={onSort} width="120px" />
              <Th label="In stage" sortKey="age" active={sortKey} dir={sortDir} onSort={onSort} align="right" width="95px" />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const rot = rotOf(d);
              const close = closeLabel(d.expected_close_date, d.stage);
              const lead = leadName(d);
              const on = selected.has(d.id);
              return (
                <tr
                  key={d.id}
                  onClick={() => onOpen(d)}
                  className={cn(
                    'cursor-pointer border-b border-[var(--border-subtle)] transition-colors last:border-0',
                    on ? 'bg-[var(--indigo-subtle)]' : 'hover:bg-[var(--bg-hover)]',
                  )}
                >
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={on} onChange={() => onToggle(d.id)} aria-label={`Select ${d.title}`} />
                  </td>

                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[12.5px] font-medium text-[var(--text-primary)]">
                        {d.title}
                      </span>
                      {rot.rotting && (
                        <span
                          title={`No movement for ${rot.days} days — ${d.stage} deals are expected to move within ${rot.limit}`}
                          className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400"
                        >
                          <Clock className="h-2.5 w-2.5" /> Stalled
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="px-3 py-2.5">
                    {d.company ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onOpenCompany(d); }}
                        className="inline-flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:text-[var(--indigo)]"
                      >
                        <Building2 className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate">{d.company}</span>
                      </button>
                    ) : (
                      <span className="text-[12px] text-[var(--text-muted)]">—</span>
                    )}
                  </td>

                  <td className="px-3 py-2.5">
                    {lead ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onOpenLead(d); }}
                        className="inline-flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:text-[var(--indigo)]"
                      >
                        <Avatar name={lead} email={leadEmail(d)} size="xs" />
                        <span className="truncate">{lead}</span>
                      </button>
                    ) : (
                      <span className="text-[12px] text-[var(--text-muted)]">—</span>
                    )}
                  </td>

                  {/* Editable in place. Changing a stage is the commonest edit
                      there is, and making it a row-open-then-form round trip is
                      why pipelines go stale. */}
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <div className="relative inline-flex items-center gap-1.5">
                      <span className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', STAGE_DOT[d.stage])} />
                      <select
                        value={d.stage}
                        onChange={(e) => onStageChange(d, e.target.value as DealStage)}
                        aria-label={`Stage for ${d.title}`}
                        className="cursor-pointer appearance-none bg-transparent pr-4 text-[12px] font-medium text-[var(--text-primary)] outline-none focus:underline"
                      >
                        {DEAL_STAGES.map((s) => (
                          <option key={s.id} value={s.id}>{s.label}</option>
                        ))}
                      </select>
                    </div>
                  </td>

                  <td className="px-3 py-2.5 text-right text-[12.5px] font-semibold tabular-nums text-[var(--text-primary)]">
                    {money(d.value, d.currency || currency)}
                  </td>

                  <td
                    className="px-3 py-2.5 text-right text-[12px] tabular-nums text-[var(--text-secondary)]"
                    title={`${probabilityOf(d)}% of ${money(d.value, d.currency || currency)}`}
                  >
                    {money(weightedValue(d), d.currency || currency)}
                    <span className="ml-1 text-[10.5px] text-[var(--text-muted)]">{probabilityOf(d)}%</span>
                  </td>

                  <td className={cn('px-3 py-2.5 text-[12px] tabular-nums', close.tone)}>{close.text}</td>

                  <td
                    className={cn(
                      'px-3 py-2.5 text-right text-[12px] tabular-nums',
                      rot.rotting ? 'font-medium text-rose-500' : 'text-[var(--text-tertiary)]',
                    )}
                  >
                    {rot.days === null ? '—' : `${rot.days}d`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

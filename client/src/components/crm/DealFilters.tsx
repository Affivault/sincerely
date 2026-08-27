import { DEAL_STAGES, isOpen, rotOf } from '@lemlist/shared';
import type { Deal, DealStage } from '@lemlist/shared';
import { cn } from '../../lib/utils';
import { KanbanSquare, Rows3, X } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════════
   Narrowing the pipeline down to the deals you meant.

   Search across a title was the whole of it, which answers "where is that
   deal" and none of the questions people actually open this page with:
   what is slipping, what closes this month, what has gone quiet, what is
   big enough to care about.
   ═══════════════════════════════════════════════════════════════════════ */

export type DealView = 'board' | 'table';

/** A named slice of the pipeline. `all` is not a filter, it is the absence of one. */
export type DealFocus = 'all' | 'open' | 'stalled' | 'overdue' | 'closing' | 'won' | 'lost';

export interface DealFilterState {
  focus: DealFocus;
  stages: DealStage[];
  /** Minimum deal value. 0 means no floor. */
  minValue: number;
}

export const EMPTY_FILTERS: DealFilterState = { focus: 'open', stages: [], minValue: 0 };

const FOCUS_LABEL: Record<DealFocus, string> = {
  all: 'All',
  open: 'Open',
  stalled: 'Stalled',
  overdue: 'Past close',
  closing: 'Closing 30d',
  won: 'Won',
  lost: 'Lost',
};

/** Start of today, so date comparisons don't drift with the clock. */
function today(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Apply a filter set to the pipeline.
 *
 * Pure and exported so the counts on the chips and the rows in the view are
 * produced by the same code — a chip that says 7 above a list of 5 is the
 * fastest way to lose someone's trust in the whole page.
 */
export function applyDealFilters(deals: Deal[], f: DealFilterState, query: string): Deal[] {
  const q = query.trim().toLowerCase();
  const floor = today();
  const horizon = floor + 30 * 86_400_000;

  return deals.filter((d) => {
    if (f.focus === 'open' && !isOpen(d.stage)) return false;
    if (f.focus === 'won' && d.stage !== 'won') return false;
    if (f.focus === 'lost' && d.stage !== 'lost') return false;
    if (f.focus === 'stalled' && !rotOf(d).rotting) return false;

    if (f.focus === 'overdue' || f.focus === 'closing') {
      // Both are statements about a deal that might still close, so a closed
      // one is never either.
      if (!isOpen(d.stage) || !d.expected_close_date) return false;
      const close = new Date(d.expected_close_date).getTime();
      if (!Number.isFinite(close)) return false;
      if (f.focus === 'overdue' && close >= floor) return false;
      if (f.focus === 'closing' && (close < floor || close > horizon)) return false;
    }

    if (f.stages.length > 0 && !f.stages.includes(d.stage)) return false;
    if (f.minValue > 0 && (Number(d.value) || 0) < f.minValue) return false;

    if (q) {
      const lead = d.contact
        ? [d.contact.first_name, d.contact.last_name].filter(Boolean).join(' ')
        : d.contact_name;
      const haystack = [d.title, d.company, lead, d.contact?.email, d.contact_email, d.notes];
      if (!haystack.filter(Boolean).some((v) => String(v).toLowerCase().includes(q))) return false;
    }

    return true;
  });
}

/** How many deals each focus would show, ignoring the other filters. */
function focusCount(deals: Deal[], focus: DealFocus): number {
  return applyDealFilters(deals, { ...EMPTY_FILTERS, focus }, '').length;
}

export function DealFilters({
  deals,
  filters,
  onChange,
  view,
  onView,
}: {
  deals: Deal[];
  filters: DealFilterState;
  onChange: (f: DealFilterState) => void;
  view: DealView;
  onView: (v: DealView) => void;
}) {
  const focuses: DealFocus[] = ['open', 'stalled', 'overdue', 'closing', 'won', 'lost', 'all'];
  const narrowed = filters.stages.length > 0 || filters.minValue > 0;

  const toggleStage = (stage: DealStage) => {
    const on = filters.stages.includes(stage);
    onChange({
      ...filters,
      stages: on ? filters.stages.filter((s) => s !== stage) : [...filters.stages, stage],
    });
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {/* The named slices. Counted, and hidden when empty — a chip reading
          "Stalled 0" is an invitation to press something that does nothing. */}
      <div className="inline-flex items-center gap-1 rounded-[9px] bg-[var(--bg-elevated)] p-0.5">
        {focuses.map((focus) => {
          const count = focusCount(deals, focus);
          if (count === 0 && focus !== 'open' && focus !== 'all' && filters.focus !== focus) return null;
          const on = filters.focus === focus;
          return (
            <button
              key={focus}
              type="button"
              onClick={() => onChange({ ...filters, focus })}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-[7px] px-2.5 py-1 text-[12px] font-medium transition-colors',
                on
                  ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
                !on && (focus === 'stalled' || focus === 'overdue') && count > 0 && 'text-rose-500',
              )}
            >
              {FOCUS_LABEL[focus]}
              <span className={cn('tabular-nums', on ? 'text-[var(--text-tertiary)]' : 'opacity-70')}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Stage narrowing, offered only where it adds something. Inside the
          board the columns already are the stages. */}
      {view === 'table' && (
        <div className="inline-flex items-center gap-1">
          {DEAL_STAGES.map((s) => {
            const on = filters.stages.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleStage(s.id)}
                className={cn(
                  'rounded-lg px-2 py-1 text-[11.5px] font-medium transition-colors',
                  on
                    ? 'bg-[var(--indigo)] text-white'
                    : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]',
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      )}

      {narrowed && (
        <button
          type="button"
          onClick={() => onChange({ ...filters, stages: [], minValue: 0 })}
          className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
        >
          <X className="h-3 w-3" /> Clear
        </button>
      )}

      <span className="flex-1" />

      <div className="inline-flex items-center gap-0.5 rounded-[9px] bg-[var(--bg-elevated)] p-0.5">
        {([['board', KanbanSquare, 'Board'], ['table', Rows3, 'Table']] as const).map(([id, Icon, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => onView(id)}
            title={label}
            aria-pressed={view === id}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[7px] px-2.5 py-1 text-[12px] font-medium transition-colors',
              view === id
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

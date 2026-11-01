import { Building2, CalendarClock, Clock, Trophy, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '../shared/Avatar';
import { usePeek } from '../peek/usePeek';
import { DealHealthDot } from './DealHealth';
import { NextActivity, type NextStepInfo } from './NextActivity';
import { ChecklistBadge } from './StageChecklist';
import { usePipelines } from '../../hooks/usePipelines';
import { cn } from '../../lib/utils';
import {
  formatDayMonth, formatMoney, parseDay, probabilityOf, rotOf,
  type Deal, type DealHealth, type DealLabel,
} from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   One deal on a board.

   Read top to bottom the way a rep scans: what it is, who it is with, what
   it is worth, and what happens next. Anything that needs attention - a
   late next step, no next step at all, a deal that has gone quiet - shows
   in colour on the card, so the board itself is the to-do list.
   ═══════════════════════════════════════════════════════════════════════ */

export function dealPerson(d: Deal): string | null {
  if (d.contact) {
    const n = [d.contact.first_name, d.contact.last_name].filter(Boolean).join(' ');
    if (n) return n;
  }
  return d.contact_name || d.contact?.email || d.contact_email || null;
}
export function dealPersonEmail(d: Deal): string | null {
  return d.contact?.email || d.contact_email || null;
}
export function dealPersonId(d: Deal): string | null {
  return d.contact_id || d.contact?.id || null;
}
export function dealCompanyId(d: Deal): string | null {
  return d.company_id || d.contact?.company_id || null;
}

const LABEL_TONE: Record<DealLabel, string> = {
  hot: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  warm: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  cold: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
};

function closeInfo(iso: string | null, open: boolean): { label: string; late: boolean } | null {
  const d = parseDay(iso);
  if (!d) return null;
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(d) - start(new Date())) / 86_400_000);
  if (open && diff < 0) return { label: `${formatDayMonth(d)}`, late: true };
  return { label: formatDayMonth(d), late: false };
}

export function DealCard({
  deal, next, health, dragging, draggable, onOpen, onDragStart, onDragEnd, onDragOver, stageName,
}: {
  deal: Deal;
  next: NextStepInfo | undefined;
  health?: DealHealth;
  dragging?: boolean;
  draggable?: boolean;
  onOpen: (d: Deal) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  /** Shown on boards that are not laid out by stage (the forecast). */
  stageName?: string;
}) {
  const { openPeek } = usePeek();
  const pipes = usePipelines();
  const navigate = useNavigate();
  const open = deal.stage !== 'won' && deal.stage !== 'lost';
  const rot = rotOf(deal);
  const person = dealPerson(deal);
  const personId = dealPersonId(deal);
  const close = closeInfo(deal.expected_close_date, open);
  const odds = probabilityOf(deal);

  const openCompany = () => {
    const id = dealCompanyId(deal);
    if (id) openPeek('company', id);
    else if (deal.company) navigate(`/companies?q=${encodeURIComponent(deal.company)}`);
  };

  return (
    /* A div, not a button: the company, the person and the next step inside
       are themselves buttons, and a button inside a button is invalid. The
       title is the focusable "open" control. */
    <div
      draggable={draggable}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart?.(); }}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onClick={() => onOpen(deal)}
      className={cn(
        'group relative my-1.5 w-full overflow-visible rounded-xl border bg-[var(--bg-surface)] p-3 text-left shadow-[var(--shadow-sm)] transition-all hover:-translate-y-px hover:shadow-[var(--shadow-md)]',
        rot.rotting && open ? 'border-rose-500/40' : 'border-[var(--border-subtle)] hover:border-[var(--border-default)]',
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        dragging && 'rotate-1 opacity-40',
      )}
    >
      {rot.rotting && open && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-rose-500" />}

      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen(deal); }}
          className="min-w-0 flex-1 rounded text-left text-strong font-semibold leading-snug text-[var(--text-primary)] line-clamp-2 hover:text-[var(--indigo-text)]"
        >
          {deal.title}
        </button>
        {deal.stage === 'won' && <Trophy aria-label="Won" className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />}
        {deal.stage === 'lost' && <XCircle aria-label="Lost" className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-rose-500" />}
        {deal.label && (
          <span className={cn('flex-shrink-0 rounded-full px-1.5 py-0.5 text-micro font-semibold capitalize', LABEL_TONE[deal.label])}>{deal.label}</span>
        )}
      </div>

      {(deal.company || person) && (
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-caption text-[var(--text-tertiary)]">
          {deal.company && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); openCompany(); }}
              title={`Open ${deal.company}`}
              className="inline-flex min-w-0 items-center gap-1 rounded transition-colors hover:text-[var(--indigo-text)] hover:underline"
            >
              <Building2 className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{deal.company}</span>
            </button>
          )}
          {deal.company && person && <span aria-hidden="true">·</span>}
          {person && (
            personId ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); openPeek('contact', personId); }}
                title={`Open ${dealPersonEmail(deal) || person}`}
                className="min-w-0 truncate rounded transition-colors hover:text-[var(--indigo-text)] hover:underline"
              >
                {person}
              </button>
            ) : (
              <span className="min-w-0 truncate">{person}</span>
            )
          )}
        </div>
      )}

      <div className="mt-2.5 flex items-center gap-2">
        <span className="text-strong font-semibold tabular-nums text-[var(--text-primary)]">{formatMoney(deal.value, deal.currency || 'USD')}</span>
        {open && <span className="text-micro tabular-nums text-[var(--text-tertiary)]" title="Odds of closing">{odds}%</span>}
        {stageName && <span className="truncate rounded-full bg-[var(--bg-muted)] px-1.5 py-0.5 text-micro font-medium text-[var(--text-secondary)]">{stageName}</span>}
        <span className="flex-1" />
        <DealHealthDot health={health} />
        {person && <Avatar name={person} email={dealPersonEmail(deal)} size="xs" />}
      </div>

      {open && (
        <div className="mt-2 flex items-center gap-1.5 border-t border-[var(--border-subtle)] pt-2">
          <span className="min-w-0 flex-1"><NextActivity deal={deal} info={next} compact /></span>
          {pipes.styled && <ChecklistBadge stage={pipes.stageOf(deal)} deal={deal} />}
          {rot.rotting && (
            <span
              title={`No movement for ${rot.days} days. Deals here are expected to move within ${rot.limit}.`}
              className="inline-flex flex-shrink-0 items-center gap-0.5 rounded-full bg-rose-500/10 px-1.5 py-0.5 text-micro font-semibold tabular-nums text-rose-600 dark:text-rose-400"
            >
              <Clock className="h-2.5 w-2.5" />{rot.days}d
            </span>
          )}
          {close && (
            <span
              title={close.late ? 'Past its expected close date' : 'Expected close'}
              className={cn('inline-flex flex-shrink-0 items-center gap-0.5 text-micro tabular-nums', close.late ? 'font-semibold text-rose-600 dark:text-rose-400' : 'text-[var(--text-tertiary)]')}
            >
              <CalendarClock className="h-3 w-3" />{close.label}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { crmApi } from '../../api/crm.api';
import { useFillViewport, autoScrollX, autoScrollY } from '../../hooks/useFillViewport';
import { cn } from '../../lib/utils';
import { DealCard } from './DealCard';
import type { NextStepInfo } from './NextActivity';
import { formatMoney, formatMonthYear, parseDay, weightedValue, type Deal, type DealHealth } from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   The pipeline by when it should close.

   Columns are months. Open deals sit in the month they are expected to
   close, won deals in the month they actually closed, so each column reads
   as "what we expect, and what we have already banked". Dragging a deal to
   another month moves its close date; that is the whole forecast meeting.
   ═══════════════════════════════════════════════════════════════════════ */

const MONTHS_AHEAD = 6;

interface Bucket { id: string; label: string; sub?: string; start?: Date; droppable: boolean }

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function buckets(now = new Date()): Bucket[] {
  const out: Bucket[] = [
    { id: 'none', label: 'No close date', droppable: true },
    { id: 'late', label: 'Past close date', sub: 'Still open', droppable: false },
  ];
  for (let i = 0; i < MONTHS_AHEAD; i++) {
    const start = new Date(now.getFullYear(), now.getMonth() + i, 1);
    out.push({
      id: monthKey(start),
      label: formatMonthYear(start),
      sub: i === 0 ? 'This month' : i === 1 ? 'Next month' : undefined,
      start,
      droppable: true,
    });
  }
  return out;
}

function bucketOf(d: Deal, now = new Date()): string | null {
  if (d.stage === 'lost') return null;
  if (d.stage === 'won') {
    if (!d.closed_at) return null;
    const c = new Date(d.closed_at);
    return monthKey(c);
  }
  const close = parseDay(d.expected_close_date);
  if (!close) return 'none';
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (close.getTime() < today.getTime()) return 'late';
  return monthKey(close);
}

/** Same day of the new month when there was one, else the month's last day. */
function moveDate(d: Deal, start: Date): string {
  const prev = parseDay(d.expected_close_date);
  const last = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  const day = prev ? Math.min(prev.getDate(), last) : last;
  const today = new Date();
  let target = new Date(start.getFullYear(), start.getMonth(), day);
  // Moving into this month never lands a deal in the past.
  if (target.getTime() < new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) target = today;
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
}

export function ForecastBoard({
  deals, next, health, onOpen, stageName, dragDisabled,
}: {
  deals: Deal[];
  next: Map<string, NextStepInfo>;
  health?: Record<string, DealHealth>;
  onOpen: (d: Deal) => void;
  stageName: (d: Deal) => string;
  dragDisabled?: boolean;
}) {
  const qc = useQueryClient();
  const cols = useMemo(() => buckets(), []);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const { ref: boardRef, height } = useFillViewport<HTMLDivElement>({ min: 320 });

  const byBucket = useMemo(() => {
    const m = new Map<string, Deal[]>();
    for (const d of deals) {
      const b = bucketOf(d);
      if (!b) continue;
      const list = m.get(b) || [];
      list.push(d);
      m.set(b, list);
    }
    for (const list of m.values()) list.sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));
    return m;
  }, [deals]);

  const drop = async (bucket: Bucket) => {
    const deal = deals.find((d) => d.id === dragId);
    setDragId(null);
    setOver(null);
    if (!deal || !bucket.droppable || deal.stage === 'won') return;
    const date = bucket.start ? moveDate(deal, bucket.start) : null;
    if ((deal.expected_close_date || null) === date) return;
    qc.setQueryData<Deal[]>(['crm', 'deals'], (old) => (old || []).map((d) => (d.id === deal.id ? { ...d, expected_close_date: date } : d)));
    try {
      await crmApi.updateDeal(deal.id, { expected_close_date: date });
      toast.success(date ? `Now expected to close ${bucket.label}` : 'Close date cleared');
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Could not move that deal');
    } finally {
      qc.invalidateQueries({ queryKey: ['crm'] });
    }
  };

  return (
    <div
      ref={boardRef}
      style={height ? { height } : undefined}
      onDragOver={(e) => autoScrollX(boardRef.current, e.clientX)}
      className="flex gap-3 overflow-x-auto pb-2"
    >
      {cols.map((b) => {
        const items = byBucket.get(b.id) || [];
        if (b.id === 'late' && items.length === 0) return null;
        const openItems = items.filter((d) => d.stage !== 'won');
        const won = items.filter((d) => d.stage === 'won').reduce((s, d) => s + (Number(d.value) || 0), 0);
        const expected = openItems.reduce((s, d) => s + weightedValue(d), 0);
        const total = openItems.reduce((s, d) => s + (Number(d.value) || 0), 0);
        const hot = over === b.id && b.droppable;
        return (
          <section
            key={b.id}
            aria-label={b.label}
            onDragOver={(e) => { if (!b.droppable) return; e.preventDefault(); setOver(b.id); }}
            onDrop={(e) => { e.preventDefault(); drop(b); }}
            className={cn(
              'flex h-full min-h-0 w-72 flex-shrink-0 flex-col rounded-2xl border transition-colors',
              hot ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)]' : 'border-[var(--border-subtle)] bg-[var(--bg-muted)]/40',
              b.id === 'late' && 'border-rose-500/30',
            )}
          >
            <header className="flex-shrink-0 px-3 pb-2 pt-3">
              <div className="flex items-baseline gap-2">
                <h3 className={cn('text-strong font-semibold', b.id === 'late' ? 'text-rose-600 dark:text-rose-400' : 'text-[var(--text-primary)]')}>{b.label}</h3>
                {b.sub && <span className="text-caption text-[var(--text-tertiary)]">{b.sub}</span>}
                <span className="ml-auto text-caption font-medium tabular-nums text-[var(--text-tertiary)]">{items.length}</span>
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <div>
                  <p className="text-micro uppercase tracking-wide text-[var(--text-tertiary)]">Expected</p>
                  <p className="text-body font-semibold tabular-nums text-[var(--text-primary)]" title={`${formatMoney(total)} before odds`}>{formatMoney(expected)}</p>
                </div>
                <div>
                  <p className="text-micro uppercase tracking-wide text-[var(--text-tertiary)]">Won</p>
                  <p className={cn('text-body font-semibold tabular-nums', won > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--text-tertiary)]')}>{formatMoney(won)}</p>
                </div>
              </div>
            </header>
            <div onDragOver={(e) => autoScrollY(e.currentTarget, e.clientY)} className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
              {items.map((d) => (
                <DealCard
                  key={d.id}
                  deal={d}
                  next={next.get(d.id)}
                  health={health?.[d.id]}
                  stageName={d.stage === 'won' ? undefined : stageName(d)}
                  draggable={!dragDisabled && d.stage !== 'won'}
                  dragging={dragId === d.id}
                  onDragStart={() => setDragId(d.id)}
                  onDragEnd={() => { setDragId(null); setOver(null); }}
                  onOpen={onOpen}
                />
              ))}
              {items.length === 0 && (
                <p className="py-6 text-center text-caption text-[var(--text-tertiary)]">
                  {b.droppable ? 'Drag a deal here to move its close date' : 'Nothing here'}
                </p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

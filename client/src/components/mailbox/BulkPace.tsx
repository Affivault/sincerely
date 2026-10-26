import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Gauge } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  RECOMMENDED_DAILY_LIMIT, RECOMMENDED_GAP, DAILY_LIMIT_PRESETS, GAP_PRESETS, MAX_GAP_SECONDS,
  formatGap, gapCapacityPerDay, gapProblem, dailyLimitProblem, plural,
} from '@lemlist/shared';
import { smtpApi } from '../../api/smtp.api';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Checkbox } from '../ui/Checkbox';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   One sending pace, many mailboxes.

   Each mailbox's drawer can set its own pace, and that is right for the
   one that needs to be different. It was the only way, though, so a fleet
   of thirty kept whatever each mailbox was connected with - three
   generations of defaults - and moving all of them to a careful pace after
   a bounce spike was thirty saves.

   This sets one daily limit and one gap on the mailboxes ticked (all of
   them unless the caller narrows it), starting from the recommended
   values, and says afterwards how many actually changed: a mailbox that
   already had that pace is counted as such, not as work done.
   ═══════════════════════════════════════════════════════════════════════ */

export interface BulkPaceMailbox {
  id: string;
  label: string;
  email_address: string;
  daily_send_limit: number;
  gap_min: number;
  gap_max: number;
}

type Result = Awaited<ReturnType<typeof smtpApi.applyPace>>;

const chip = (active: boolean) => cn(
  'min-h-8 rounded-lg border px-2.5 text-caption font-medium transition-colors',
  active
    ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)] text-[var(--indigo-text)]'
    : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:text-[var(--text-primary)]',
);

export function BulkPace({ open, onClose, mailboxes, initialIds, initialPace }: {
  open: boolean;
  onClose: () => void;
  mailboxes: BulkPaceMailbox[];
  /** Ticked when it opens; every mailbox when omitted. */
  initialIds?: string[];
  /** Where the controls start; the recommended pace when omitted. */
  initialPace?: { limit: number; min: number; max: number };
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState<number>(RECOMMENDED_DAILY_LIMIT);
  const [gapMin, setGapMin] = useState<number>(RECOMMENDED_GAP.min);
  const [gapMax, setGapMax] = useState<number>(RECOMMENDED_GAP.max);
  const [result, setResult] = useState<Result | null>(null);

  // Reset on every opening, so a second visit does not start from the last one's choices.
  useEffect(() => {
    if (!open) return;
    setSelected(new Set(initialIds && initialIds.length ? initialIds : mailboxes.map((m) => m.id)));
    setLimit(initialPace?.limit ?? RECOMMENDED_DAILY_LIMIT);
    setGapMin(initialPace?.min ?? RECOMMENDED_GAP.min);
    setGapMax(initialPace?.max ?? RECOMMENDED_GAP.max);
    setResult(null);
    // The props are read once per opening on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const limitIssue = dailyLimitProblem(limit);
  const gapIssue = gapProblem(gapMin, gapMax);
  const ceiling = gapCapacityPerDay(gapMin, gapMax);
  const allTicked = selected.size === mailboxes.length && mailboxes.length > 0;
  const alreadySet = useMemo(
    () => mailboxes.filter((m) => selected.has(m.id) && m.daily_send_limit === limit && m.gap_min === gapMin && m.gap_max === gapMax).length,
    [mailboxes, selected, limit, gapMin, gapMax],
  );

  const apply = useMutation({
    mutationFn: () => smtpApi.applyPace({
      account_ids: allTicked ? 'all' : [...selected],
      daily_send_limit: limit,
      send_gap_min_seconds: gapMin,
      send_gap_max_seconds: gapMax,
    }),
    onSuccess: (r) => {
      setResult(r);
      queryClient.invalidateQueries({ queryKey: ['smtp-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['sending-health'] });
      toast.success(r.changed === 0
        ? `Every chosen mailbox already had this pace`
        : `Pace set on ${plural(r.changed, 'mailbox', 'mailboxes')}`);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Could not set the pace'),
  });

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const blocked = selected.size === 0 ? 'Choose at least one mailbox' : limitIssue || gapIssue;

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Set the sending pace"
      description="One daily limit and one gap between emails, on every mailbox you choose."
      size="lg"
      footer={result ? (
        <Button onClick={onClose}>Done</Button>
      ) : (
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => apply.mutate()} disabled={!!blocked || apply.isPending} title={blocked || undefined}>
            {apply.isPending ? 'Applying…' : allTicked ? 'Apply to all mailboxes' : `Apply to ${plural(selected.size, 'mailbox', 'mailboxes')}`}
          </Button>
        </>
      )}
    >
      {result ? (
        <div className="flex items-start gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4" role="status">
          <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="space-y-1 text-body text-[var(--text-secondary)]">
            <p className="font-semibold text-[var(--text-primary)]">
              {result.changed === 0
                ? 'Nothing needed changing.'
                : `${plural(result.changed, 'mailbox', 'mailboxes')} now ${result.changed === 1 ? 'sends' : 'send'} at most ${limit} a day, ${formatGap(gapMin, gapMax)} apart.`}
            </p>
            {result.unchanged > 0 && <p>{result.unchanged} already had this pace.</p>}
            {result.skipped > 0 && <p>{result.skipped} could not be found, so {result.skipped === 1 ? 'it was' : 'they were'} left alone.</p>}
            {!result.gap_saved && <p>The daily limit was saved. The gap needs migration 089 before it can be stored.</p>}
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <section>
            <p id="bulk-pace-limit" className="text-caption font-semibold text-[var(--text-secondary)]">Most emails a day, per mailbox</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-labelledby="bulk-pace-limit">
              {DAILY_LIMIT_PRESETS.map((p) => (
                <button key={p.value} type="button" role="radio" aria-checked={limit === p.value} onClick={() => setLimit(p.value)} className={chip(limit === p.value)}>
                  {p.label}{p.recommended ? ' · Recommended' : ''}
                </button>
              ))}
              <Input
                aria-label="Custom daily limit"
                type="number"
                min={1}
                placeholder="Custom"
                value={DAILY_LIMIT_PRESETS.some((p) => p.value === limit) ? '' : String(limit)}
                onChange={(e) => setLimit(parseInt(e.target.value, 10) || 0)}
                error={limitIssue || undefined}
                className="!w-24"
              />
            </div>
            <p className="mt-1.5 text-caption text-[var(--text-tertiary)]">
              {DAILY_LIMIT_PRESETS.find((p) => p.value === limit)?.note || 'A custom limit. Warm-up and the autopilot can still hold a mailbox below it.'}
            </p>
          </section>

          <section>
            <p id="bulk-pace-gap" className="text-caption font-semibold text-[var(--text-secondary)]">Gap between emails</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-labelledby="bulk-pace-gap">
              {GAP_PRESETS.map((p) => {
                const on = gapMin === p.min && gapMax === p.max;
                return (
                  <button key={p.label} type="button" role="radio" aria-checked={on} onClick={() => { setGapMin(p.min); setGapMax(p.max); }} className={chip(on)}>
                    {p.label}{p.recommended ? ' · Recommended' : ''}
                  </button>
                );
              })}
              <Input aria-label="Shortest gap in seconds" type="number" min={0} max={MAX_GAP_SECONDS} value={String(gapMin)}
                onChange={(e) => setGapMin(parseInt(e.target.value, 10) || 0)} className="!w-20" />
              <span className="text-caption text-[var(--text-tertiary)]">to</span>
              <Input aria-label="Longest gap in seconds" type="number" min={0} max={MAX_GAP_SECONDS} value={String(gapMax)}
                onChange={(e) => setGapMax(parseInt(e.target.value, 10) || 0)} className="!w-20" />
              <span className="text-caption text-[var(--text-tertiary)]">seconds</span>
            </div>
            <p className={cn('mt-1.5 text-caption', gapIssue ? 'text-[var(--error)]' : 'text-[var(--text-tertiary)]')}>
              {gapIssue
                || GAP_PRESETS.find((p) => p.min === gapMin && p.max === gapMax)?.note
                || `A random wait of ${formatGap(gapMin, gapMax)} after each email.`}
              {!gapIssue && !limitIssue && Number.isFinite(ceiling) && ceiling < limit
                && ` At this gap one mailbox sends about ${ceiling} in an eight-hour day, below the limit.`}
            </p>
          </section>

          <section>
            <div className="flex items-center justify-between gap-2">
              <p className="text-caption font-semibold text-[var(--text-secondary)]">
                Mailboxes · {selected.size} of {mailboxes.length}
              </p>
              <button
                type="button"
                className="text-caption font-medium text-[var(--indigo-text)] hover:underline"
                onClick={() => setSelected(allTicked ? new Set() : new Set(mailboxes.map((m) => m.id)))}
              >
                {allTicked ? 'Clear' : 'Choose all'}
              </button>
            </div>
            <ul className="mt-1.5 max-h-56 divide-y divide-[var(--border-subtle)] overflow-y-auto rounded-lg border border-[var(--border-subtle)]">
              {mailboxes.map((m) => (
                <li key={m.id} className="flex items-center gap-2.5 px-3 py-2">
                  <Checkbox checked={selected.has(m.id)} onChange={() => toggle(m.id)} aria-label={`Include ${m.email_address}`} />
                  <span className="min-w-0 flex-1 truncate text-body text-[var(--text-primary)]">{m.email_address}</span>
                  <span className="flex-shrink-0 text-caption tabular text-[var(--text-tertiary)]">
                    {m.daily_send_limit === 0 ? 'No limit' : `${m.daily_send_limit}/day`} · {formatGap(m.gap_min, m.gap_max)}
                  </span>
                </li>
              ))}
            </ul>
            {alreadySet > 0 && (
              <p className="mt-1.5 flex items-center gap-1.5 text-caption text-[var(--text-tertiary)]">
                <Gauge className="h-3 w-3" /> {alreadySet} of the chosen already {alreadySet === 1 ? 'has' : 'have'} this pace.
              </p>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

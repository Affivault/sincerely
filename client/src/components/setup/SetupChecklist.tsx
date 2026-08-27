import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { setupApi } from '../../api/setup.api';
import type { SetupStep } from '@lemlist/shared';
import { cn } from '../../lib/utils';
import { AlertTriangle, ArrowRight, Check } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════════
   The first ten minutes.

   Signing up landed you on a dashboard with nothing in it and a sidebar
   with forty-odd pages beside it. Everything this platform does was behind
   a door nobody had mentioned, and the order the doors have to be opened
   in — mailbox, then domain, then contacts, then a sequence — was
   discoverable only by trying things and hitting errors.

   Five steps, in dependency order, each reading its real state from the
   API. It cannot congratulate you for something you have not done, and it
   cannot nag you about something you did elsewhere. When the last one is
   true it stops rendering, permanently, with nothing to dismiss.
   ═══════════════════════════════════════════════════════════════════════ */

function StepRow({ step, index }: { step: SetupStep; index: number }) {
  const dim = !step.done && !step.current;

  return (
    <li
      className={cn(
        'flex items-start gap-3 px-4 py-3 border-b border-[var(--border-subtle)] last:border-0 transition-colors',
        step.current && 'bg-[var(--indigo-subtle)]/40',
      )}
    >
      <span
        className={cn(
          'mt-px flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold',
          step.done
            ? 'bg-emerald-500 text-white'
            : step.current
              ? 'bg-[var(--indigo)] text-white'
              : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]',
        )}
      >
        {step.done ? <Check className="h-3 w-3" strokeWidth={3.5} /> : index + 1}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span
            className={cn(
              'text-[13px] font-semibold',
              step.done
                ? 'text-[var(--text-tertiary)] line-through decoration-[var(--text-muted)]'
                : dim
                  ? 'text-[var(--text-secondary)]'
                  : 'text-[var(--text-primary)]',
            )}
          >
            {step.label}
          </span>
          {step.progress && (
            <span className="text-[11px] font-medium text-[var(--text-tertiary)]">{step.progress}</span>
          )}
        </div>

        {/* The explanation earns its place only where a decision is being
            made. Repeating it under five ticked-off rows is just noise. */}
        {!step.done && step.current && (
          <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--text-secondary)]">{step.detail}</p>
        )}

        {step.warning && (
          <p className="mt-1 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-amber-600 dark:text-amber-400">
            <AlertTriangle className="mt-px h-3 w-3 flex-shrink-0" />
            {step.warning}
          </p>
        )}
      </div>

      {/* One call to action, on the step that is actually next. A row of
          five buttons is five decisions and therefore none. */}
      {step.current && (
        <Link
          to={step.href}
          className="mt-px inline-flex flex-shrink-0 items-center gap-1 rounded-lg bg-[var(--indigo)] px-2.5 py-1.5 text-[11.5px] font-semibold text-white transition-opacity hover:opacity-90"
        >
          {step.cta}
          <ArrowRight className="h-3 w-3" />
        </Link>
      )}
      {!step.current && !step.done && (
        <Link
          to={step.href}
          className="mt-1 flex-shrink-0 text-[11.5px] font-medium text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
        >
          {step.cta}
        </Link>
      )}
      {step.done && step.warning && (
        <Link
          to={step.href}
          className="mt-1 flex-shrink-0 text-[11.5px] font-medium text-amber-600 transition-opacity hover:opacity-80 dark:text-amber-400"
        >
          Fix
        </Link>
      )}
    </li>
  );
}

export function SetupChecklist() {
  const { data, isLoading } = useQuery({
    queryKey: ['setup-state'],
    queryFn: setupApi.get,
    // Doing a step means leaving this page and coming back, so the answer
    // has to be re-asked rather than served from a cache that predates it.
    staleTime: 0,
    refetchOnWindowFocus: true,
    meta: { silentError: true },
  });

  if (isLoading) return <div className="h-40 rounded-xl bg-[var(--bg-elevated)] animate-pulse" />;

  // Nothing to show, and nothing to dismiss: the checklist retires on the
  // strength of the account's own state, so it can never come back to haunt
  // someone who is already sending.
  if (!data || data.complete) return null;

  const pct = Math.round((data.done_count / data.steps.length) * 100);

  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-[var(--border-subtle)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[13.5px] font-semibold text-[var(--text-primary)]">
              {data.fresh ? 'Get your first campaign out' : 'Finish setting up'}
            </h3>
            <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--text-secondary)]">
              {data.fresh
                ? 'Five steps, in the order they depend on each other. Most of it is once, and then never again.'
                : 'A few things are still outstanding — each one is something a campaign will otherwise trip over.'}
            </p>
          </div>
          <span className="flex-shrink-0 text-[11.5px] font-semibold tabular-nums text-[var(--text-tertiary)]">
            {data.done_count}/{data.steps.length}
          </span>
        </div>

        <div className="mt-3 h-1 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
          <div
            className="h-full rounded-full bg-[var(--indigo)] transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <ul>
        {data.steps.map((step, i) => (
          <StepRow key={step.id} step={step} index={i} />
        ))}
      </ul>
    </div>
  );
}

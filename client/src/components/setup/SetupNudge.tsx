import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { setupApi } from '../../api/setup.api';
import { setupNudge } from '@lemlist/shared';
import { cn } from '../../lib/utils';
import { ArrowRight } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════════
   The thread back to setup, from wherever you got stuck.

   The checklist on the dashboard is good and reads real state - but the
   dashboard is precisely where somebody is not when they hit the wall.
   They follow the sidebar to Campaigns, build a sequence, press Launch,
   and are told there is no mailbox to send from. Nothing on that page
   connects the dead end to the step that was never done, and the checklist
   explaining it is one navigation away on a screen they have left.

   So it comes with them: one line in the sidebar, on every page, naming
   the single next step. It disappears the moment setup is finished, on the
   strength of the account's own state, with nothing to dismiss.

   Which step that is comes from `setupNudge` in shared rather than from
   the `current` flag, so an absent or doubled flag cannot make this render
   nothing - and rendering nothing is indistinguishable from being done.
   ═══════════════════════════════════════════════════════════════════════ */

export function SetupNudge({ collapsed }: { collapsed: boolean }) {
  const { data } = useQuery({
    queryKey: ['setup-state'],
    queryFn: setupApi.get,
    // Doing a step means navigating away and back, so the answer is re-asked
    // rather than served from a cache that predates it. Shares its key with
    // the dashboard checklist, so the two can never disagree.
    staleTime: 0,
    refetchOnWindowFocus: true,
    meta: { silentError: true },
  });

  const nudge = setupNudge(data);
  // Nothing while it loads, and nothing once it is finished. A placeholder
  // here would flash "Step 1 of 5" at an account that completed setup
  // months ago, every time the sidebar mounts.
  if (!nudge) return null;

  if (collapsed) {
    return (
      <Link
        to={nudge.step.href}
        title={`${nudge.position} — ${nudge.step.label}`}
        className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-[9px] border border-[var(--indigo)]/30 bg-[var(--indigo-subtle)] text-micro font-bold tabular-nums text-[var(--indigo)] transition-colors hover:bg-[var(--indigo-subtle)]/80"
        data-setup-nudge
      >
        {nudge.done_count}/{nudge.total}
      </Link>
    );
  }

  return (
    <Link
      to={nudge.step.href}
      className="group mx-2.5 mb-2 block rounded-[10px] border border-[var(--indigo)]/25 bg-[var(--indigo-subtle)]/60 p-2.5 transition-colors hover:bg-[var(--indigo-subtle)]"
      data-setup-nudge
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-caption font-medium text-[var(--indigo)]">{nudge.position}</span>
        <span className="text-caption font-semibold tabular-nums text-[var(--text-tertiary)]">
          {nudge.done_count}/{nudge.total}
        </span>
      </div>

      {/* The step, in the words of the button it leads to. */}
      <p className="mt-1 text-body font-semibold leading-snug text-[var(--text-primary)]">
        {nudge.step.label}
      </p>

      <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--bg-active)]">
        <div
          className={cn('h-full rounded-full bg-[var(--indigo)] transition-[width] duration-500')}
          style={{ width: `${nudge.percent}%` }}
        />
      </div>

      <span className="mt-2 inline-flex items-center gap-1 text-caption font-semibold text-[var(--indigo)]">
        {nudge.step.cta}
        <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

import { type ReactNode } from 'react';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   "These are the rows you had; the ones you asked for are coming."

   The other half of `keepPrevious` in lib/listQuery. Keeping the previous
   result on screen is what stops a list blanking every time you type a
   letter or switch a tab - but for the couple of hundred milliseconds it
   takes, the controls say one thing and the rows say another. Unmarked,
   that is a small lie: the filter reads Archived and the list is still the
   inbox.

   This is the mark. Two pixels along the top edge of the list, over the
   content rather than above it, so nothing moves when it appears or goes.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Wraps a list and draws the bar across its top edge while `active`.
 *
 * The wrapper is `relative` and the bar is absolutely positioned inside
 * it, so turning it on and off does not change the height of anything -
 * which matters more than it sounds, because this toggles on every
 * keystroke and a one-pixel reflow per keystroke is visible as a shudder.
 */
export function Refreshing({ active, children, className }: {
  active?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      {active && <span className="refresh-bar" data-refreshing aria-hidden />}
      {children}
    </div>
  );
}

/**
 * The bar on its own, for a layout that already has somewhere to put it.
 *
 * Renders nothing at all when inactive rather than an empty element, so
 * it can be dropped into a flex row without becoming a phantom gap.
 */
export function RefreshingBar({ active, className }: { active?: boolean; className?: string }) {
  if (!active) return null;
  return (
    <span className={cn('refresh-bar', className)} data-refreshing aria-hidden />
  );
}

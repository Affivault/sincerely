/* ═══════════════════════════════════════════════════════════════════════
   Undo, for the things a dialog was never really protecting.

   Thirty-seven places open a confirmation dialog, and the default body
   text is literally "This cannot be undone." For deleting a template, a
   saved view or a note that is not a warning, it is a toll: a modal
   between you and a thing you meant to do, every single time, which after
   the fourth one you stop reading. A prompt nobody reads is not a
   safeguard - it is a click.

   The fix is not to remove the pause. It is to move it AFTER the action,
   where it costs nothing when you were right and still saves you when you
   were not: the row goes immediately, a line appears offering it back, and
   the request is not sent until that line times out.

   Which makes the timer the load-bearing part, and the reason this is a
   plain class in shared rather than a setTimeout in a component:

   IT MUST SURVIVE THE PAGE IT STARTED ON. Deleting a contact and
   navigating away must still delete the contact. A timer owned by a
   component is cancelled when that component unmounts, so the delete
   silently never happens and the record is back when you return - the
   worst possible outcome, because you have already been told it was gone.

   IT MUST FIRE EXACTLY ONCE. The timer and an explicit flush race
   constantly (a second delete, a tab close, a sign-out). Committing twice
   is a second DELETE against an id that no longer exists, which surfaces
   as a spurious error on an action that worked.

   A FAILED COMMIT MUST PUT IT BACK. The row was removed on the promise of
   a request that had not been made yet. If that request then fails, the
   only honest thing is to restore the row and say so.

   One pending action at a time, deliberately. A stack of undos is a thing
   nobody can read and nobody can aim at.
   ═══════════════════════════════════════════════════════════════════════ */

export interface UndoEntry {
  /** Distinguishes this action from the next one. Any stable string. */
  id: string;
  /** What just happened, in the past tense: "Template deleted". */
  label: string;
  /** The real request. Not sent until the window closes. */
  commit: () => Promise<unknown> | unknown;
  /** Put the optimistic change back. Called on undo, and on a failed commit. */
  revert: () => void;
}

export interface PendingUndo extends UndoEntry {
  /** Epoch ms when the commit fires. */
  expiresAt: number;
}

export interface UndoQueueOptions {
  /** How long the offer stands. */
  windowMs?: number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
  /** Told whenever the pending action changes, so a toast can follow it. */
  onChange?: (pending: PendingUndo | null) => void;
  /** A commit that threw. The entry has already been reverted. */
  onError?: (entry: PendingUndo, error: unknown) => void;
}

export const UNDO_WINDOW_MS = 6000;

export class UndoQueue {
  private entry: PendingUndo | null = null;
  private handle: unknown = null;

  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancelTimer: (handle: unknown) => void;
  private readonly onChange: (pending: PendingUndo | null) => void;
  private readonly onError: (entry: PendingUndo, error: unknown) => void;

  constructor(opts: UndoQueueOptions = {}) {
    this.windowMs = opts.windowMs ?? UNDO_WINDOW_MS;
    this.now = opts.now ?? (() => Date.now());
    this.schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancelTimer = opts.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.onChange = opts.onChange ?? (() => {});
    this.onError = opts.onError ?? (() => {});
  }

  get pending(): PendingUndo | null {
    return this.entry;
  }

  /**
   * Offer an action back for a few seconds, then do it.
   *
   * A second call commits the first immediately rather than queueing or
   * dropping it. Queueing gives two toasts fighting over one slot;
   * dropping loses a deletion the user has already been told happened.
   */
  push(next: UndoEntry): void {
    // Not awaited: the previous action's request is on its way and this one
    // must not wait on the network to show its own offer.
    void this.flush();

    const pending: PendingUndo = { ...next, expiresAt: this.now() + this.windowMs };
    this.entry = pending;
    this.handle = this.schedule(() => {
      // The timer fired, so there is nothing left to cancel.
      this.handle = null;
      void this.run(pending);
    }, this.windowMs);
    this.onChange(pending);
  }

  /**
   * Take it back.
   *
   * @returns true if the action was still pending and has been cancelled.
   * False means the window had already closed, and nothing is reverted -
   * reverting an action that has already been sent would put a row back
   * that the server has deleted.
   */
  undo(id?: string): boolean {
    const pending = this.entry;
    if (!pending) return false;
    if (id != null && id !== pending.id) return false;

    this.clearTimer();
    this.entry = null;
    this.onChange(null);
    pending.revert();
    return true;
  }

  /**
   * Do it now, without waiting out the window.
   *
   * Called when a second action arrives, when the tab is closing, and on
   * sign-out. Resolves once the request has settled so a caller that can
   * wait (a sign-out, say) is able to.
   */
  async flush(): Promise<void> {
    const pending = this.entry;
    if (!pending) return;
    this.clearTimer();
    await this.run(pending);
  }

  /** Give up on a pending action without committing or reverting it. */
  reset(): void {
    this.clearTimer();
    this.entry = null;
    this.onChange(null);
  }

  private clearTimer(): void {
    if (this.handle != null) {
      this.cancelTimer(this.handle);
      this.handle = null;
    }
  }

  /**
   * Send the request, once.
   *
   * The identity check is the whole guard, and the slot is cleared before
   * anything is awaited so a second attempt at the same entry cannot get
   * past it. That matters more than it looks: `pagehide` and `beforeunload`
   * both fire on a closing tab, so two flushes for one action is the normal
   * case rather than an edge one. A second DELETE against an id that no
   * longer exists arrives as an error on an action that worked perfectly,
   * and nothing on screen could tell that apart from a real failure.
   *
   * A separate "committing" flag lived here too and never once decided
   * anything - every path it could have caught was already caught by this
   * line. It was removed rather than kept as reassurance.
   */
  private async run(pending: PendingUndo): Promise<void> {
    if (this.entry !== pending) return;
    this.entry = null;
    this.onChange(null);

    try {
      await pending.commit();
    } catch (error) {
      /*
       * The row was taken away on the promise of a request that had not
       * been made. It failed, so the row comes back - anything else leaves
       * the screen disagreeing with the database until a refresh.
       */
      pending.revert();
      this.onError(pending, error);
    }
  }
}

/** Seconds left, rounded up, for a countdown that never shows "0s left". */
export function undoSecondsLeft(pending: PendingUndo | null, now: number): number {
  if (!pending) return 0;
  return Math.max(0, Math.ceil((pending.expiresAt - now) / 1000));
}

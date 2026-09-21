/* ═══════════════════════════════════════════════════════════════════════
   The first ten minutes.

   Signing up used to land you on a dashboard with nothing in it and a
   sidebar with forty-odd pages beside it. Every feature this platform has
   was behind a door nobody had been told about, and the order those doors
   have to be opened in — mailbox before domain, domain before contacts,
   contacts before a sequence — was knowable only by trying and failing.

   So: five steps, in the order they actually depend on each other. Each
   one reads its own state from the database rather than from a "dismissed"
   flag, which means it cannot congratulate you for something you have not
   done, and it cannot nag you about something you did somewhere else. When
   the last one is true the whole thing stops existing.
   ═══════════════════════════════════════════════════════════════════════ */

export type SetupStepId = 'mailbox' | 'domain' | 'contacts' | 'sequence' | 'launch';

export interface SetupStep {
  id: SetupStepId;
  /** Imperative, short, and the same words as the button it leads to. */
  label: string;
  /** Why this one matters, for someone who has never sent cold email. */
  detail: string;
  done: boolean;
  /**
   * True when this is the step to do next: the first one not done. Exactly
   * one step is current, unless everything is done and none is.
   */
  current: boolean;
  /** Where to go. */
  href: string;
  cta: string;
  /**
   * What is already true, when that is worth saying — "2 mailboxes",
   * "412 contacts". Null when the step has not been started.
   */
  progress: string | null;
  /**
   * A step can be done and still be worth a word of warning: a mailbox that
   * is connected but failing, a domain added but unverified.
   */
  warning: string | null;
}

export interface SetupState {
  steps: SetupStep[];
  done_count: number;
  /** True once every step is done — the checklist retires itself. */
  complete: boolean;
  /**
   * True when this account has genuinely never sent anything. A returning
   * account with an incomplete checklist is not a new account, and should
   * not be handed a welcome mat.
   */
  fresh: boolean;
}

export const SETUP_STEP_ORDER: SetupStepId[] = ['mailbox', 'domain', 'contacts', 'sequence', 'launch'];

/**
 * The one step to do next, or nothing.
 *
 * Derived from `done` rather than read from the `current` flag. They agree
 * today, and the flag is the right thing for the checklist to colour rows
 * with - but a nudge that follows a flag shows nothing at all if the flag
 * is ever absent or set twice, and showing nothing is indistinguishable
 * from being finished. The list itself cannot be ambiguous: the next step
 * is the first one not done.
 */
export function nextSetupStep(state: SetupState | null | undefined): SetupStep | null {
  if (!state || state.complete) return null;
  return state.steps.find((s) => !s.done) ?? null;
}

export interface SetupNudge {
  step: SetupStep;
  done_count: number;
  total: number;
  /** 0-100, for a ring or a bar. */
  percent: number;
  /** "Step 2 of 5" - the position, so progress is legible at a glance. */
  position: string;
}

/**
 * What to carry on every other page while setup is unfinished.
 *
 * The checklist lives on the dashboard, which is exactly where somebody is
 * not when they get stuck: they follow the sidebar to Campaigns, find they
 * cannot launch one, and nothing on that page connects the dead end to the
 * mailbox they never connected. This is the thread back.
 *
 * Null whenever there is nothing honest to say - no data yet, or an
 * account that has finished. A nudge that appears while the answer is
 * still loading would flash "Step 1 of 5" at somebody who is done.
 */
export function setupNudge(state: SetupState | null | undefined): SetupNudge | null {
  const step = nextSetupStep(state);
  if (!step || !state) return null;

  const total = state.steps.length;
  if (total === 0) return null;

  const index = state.steps.indexOf(step);
  return {
    step,
    done_count: state.done_count,
    total,
    percent: Math.round((state.done_count / total) * 100),
    position: `Step ${index + 1} of ${total}`,
  };
}

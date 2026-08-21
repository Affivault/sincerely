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

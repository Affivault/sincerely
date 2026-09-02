/* ═══════════════════════════════════════════════════════════════════════
   Deciding what a reply is.

   A reply is the hinge of this whole product, and until now nothing
   happened at it. The lifecycle quietly moved from prospect to contact and
   the moment passed - no lead, no follow-up, no record of a "no". The Leads
   inbox sat empty because nothing filled it, which made it a page you had
   to remember rather than a queue that arrives.

   Three decisions, because there are only three. Somebody is worth
   pursuing, worth pursuing later, or not worth pursuing - and the third is
   as important as the first. An answered "no" that goes unrecorded is a
   person who gets the same sequence again next quarter.
   ═══════════════════════════════════════════════════════════════════════ */

export type TriageDecision = 'interested' | 'later' | 'not_interested';

export const TRIAGE_DECISIONS: {
  id: TriageDecision;
  label: string;
  /** What actually happens, said plainly before it happens. */
  effect: string;
  /** Single key, so a full inbox can be cleared without the mouse. */
  key: string;
}[] = [
  {
    id: 'interested',
    label: 'Interested',
    effect: 'Creates a lead carrying this thread, so it is waiting in Leads.',
    key: 'i',
  },
  {
    id: 'later',
    label: 'Not now',
    effect: 'Schedules a follow-up task and leaves them where they are.',
    key: 'l',
  },
  {
    id: 'not_interested',
    label: 'Not interested',
    effect: 'Suppresses them, so no campaign reaches them again.',
    key: 'n',
  },
];

/**
 * How long "not now" means.
 *
 * Offered as a few plain choices rather than a date picker: the decision is
 * made while reading a reply, and stopping to operate a calendar is what
 * turns a two-second triage into a thing people stop doing.
 */
export const SNOOZE_CHOICES: { id: string; label: string; days: number }[] = [
  { id: '3d', label: 'In 3 days', days: 3 },
  { id: '1w', label: 'In a week', days: 7 },
  { id: '1m', label: 'In a month', days: 30 },
  { id: '1q', label: 'Next quarter', days: 90 },
];

export const DEFAULT_SNOOZE_DAYS = 7;

/**
 * Why somebody said no.
 *
 * Recorded because "not interested" is the most information-dense thing a
 * prospect ever tells you, and throwing it away is how the same bad list
 * gets emailed twice. These map onto suppression reasons but are written
 * as the person's answer rather than as a system state.
 */
export const NOT_INTERESTED_REASONS: { id: string; label: string }[] = [
  { id: 'not_a_fit', label: 'Not a fit' },
  { id: 'no_budget', label: 'No budget' },
  { id: 'using_competitor', label: 'Using someone else' },
  { id: 'bad_timing', label: 'Wrong time, permanently' },
  { id: 'asked_to_stop', label: 'Asked us to stop' },
  { id: 'other', label: 'Other' },
];

export interface TriageInput {
  decision: TriageDecision;
  /** 'later' only. Falls back to DEFAULT_SNOOZE_DAYS. */
  snooze_days?: number;
  /** 'not_interested' only. One of NOT_INTERESTED_REASONS. */
  reason?: string;
  /** 'interested' only — overrides the title derived from the thread. */
  title?: string;
}

export interface TriageResult {
  decision: TriageDecision;
  /** The lead that now exists, when one was made. */
  lead_id?: string;
  /** The follow-up that was scheduled, when one was. */
  task_id?: string;
  due_at?: string;
  /** The address that will no longer be emailed. */
  suppressed_email?: string;
  /**
   * Said back to the person who pressed the key.
   *
   * The action is one keystroke and irreversible-ish, so what happened has
   * to be legible without opening another page to check.
   */
  message: string;
}

/**
 * A lead's title, from what is actually known about the thread.
 *
 * "New lead" is what a form defaults to and it makes a Leads inbox
 * unreadable at a glance - twenty rows, all named the same. The company is
 * the useful half; the person is the fallback; the subject is the last
 * resort because it is usually your own subject line quoted back.
 */
export function leadTitleFrom(input: {
  company?: string | null;
  contactName?: string | null;
  email?: string | null;
  subject?: string | null;
}): string {
  const company = input.company?.trim();
  if (company) return company;

  const person = input.contactName?.trim();
  if (person) return person;

  const local = input.email?.split('@')[0]?.trim();
  if (local) return local;

  const subject = input.subject?.replace(/^(re|fwd?)\s*:\s*/i, '').trim();
  return subject || 'New lead';
}

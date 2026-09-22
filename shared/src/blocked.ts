/* ═══════════════════════════════════════════════════════════════════════
   Why you cannot press this yet.

   MEASURED BEFORE THIS LANDED: the app stopped you from doing things by
   greying a button out, and Button.tsx carried
   `disabled:pointer-events-none` - so a blocked action could not be
   hovered, could not be focused, and said nothing at all. Several of the
   gates were conjunctions of four or five conditions:

       disabled={sendingTest || !testEmailTo || !effectiveSmtp
                 || !steps[editingStep].subject || !hasBody}

   Five reasons, one grey rectangle, and no way to find out which of them
   applies to you. `aria-invalid` appeared zero times in the whole app, so
   the field at fault was not marked either. The only route forward was to
   guess, or to fill in everything and watch for the moment the colour
   came back.

   A condition list is not the problem. Writing it without the reasons is.
   ═══════════════════════════════════════════════════════════════════════ */

/** A thing that is not yet true, and what to say about it. */
export type Blocker = readonly [unmet: boolean, reason: string];

/**
 * The first unmet condition's reason, or null when nothing blocks.
 *
 *     const blocked = firstBlocker([
 *       [!testEmailTo,   'Enter an address to send the test to'],
 *       [!effectiveSmtp, 'Choose a mailbox to send it from'],
 *       [!subject,       'This step needs a subject line'],
 *       [!hasBody,       'This step needs a body'],
 *     ]);
 *
 * FIRST, not all of them. A list of four things you have not done reads
 * as a telling-off and is mostly irrelevant at any given moment - people
 * fill a form roughly in order, so the first gap is nearly always the one
 * they are about to fix. Order the checks the way the form reads and this
 * says the useful thing every time.
 *
 * The reasons are written as instructions - "Enter an address" - rather
 * than as faults - "No address". One tells you what to do next; the other
 * tells you that you are wrong, which you already knew from the fact that
 * nothing happened.
 */
export function firstBlocker(checks: readonly Blocker[]): string | null {
  for (const [unmet, reason] of checks) {
    if (unmet) return reason;
  }
  return null;
}

/**
 * Every unmet reason, in order.
 *
 * For the rare place that genuinely wants a checklist - a launch
 * preflight, where seeing all of it at once IS the point - rather than a
 * button that has to say one thing.
 */
export function allBlockers(checks: readonly Blocker[]): string[] {
  return checks.filter(([unmet]) => unmet).map(([, reason]) => reason);
}

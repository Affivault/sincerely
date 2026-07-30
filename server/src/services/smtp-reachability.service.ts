/**
 * Whether this host can talk SMTP to the outside world at all.
 *
 * Mailbox verification needs an outbound connection to port 25, and most
 * managed hosts block it — Render, Heroku, Vercel, Fly and App Engine all do,
 * to stop themselves being used to send spam. It is a platform-level block with
 * no setting to turn off, not a misconfiguration.
 *
 * That block has two costs, and this module exists for both:
 *
 *  1. **Wasted time.** Every verification stalls for the connect timeout before
 *     failing. Verifying ten contacts became a hundred seconds of waiting for
 *     an answer that was never coming. After a few failures in a row, stop
 *     dialling and answer immediately.
 *  2. **False confidence.** A blocked connection used to be scored as
 *     "assumed valid", which awarded the SMTP layer full marks for a check that
 *     never ran. Callers need to be able to tell "the mailbox exists" from
 *     "nothing was checked", and that starts with knowing which case they're in.
 *
 * Deliberately in-process: it is a property of the machine, not of any user, and
 * a wrong guess self-corrects within the cooldown. A multi-instance deployment
 * gets one of these per instance, which is correct — reachability is per host.
 */

/** Consecutive connect failures before concluding the port is blocked. */
const FAILURES_BEFORE_GIVING_UP = 3;

/**
 * How long to stay given-up before letting one connection through to re-test.
 * Long enough that a batch run doesn't keep re-probing, short enough that
 * opening the port (or moving host) starts working without a restart.
 */
const RETRY_AFTER_MS = 15 * 60_000;

const state = {
  /** null until anything has been attempted. */
  available: null as boolean | null,
  consecutiveFailures: 0,
  /** When we concluded it was blocked, for the re-test window. */
  blockedAt: 0,
  lastReason: '',
};

/**
 * True when a connection attempt would be a waste of time.
 *
 * Lets exactly one attempt through once the retry window has passed, so the
 * conclusion is re-tested rather than cached forever.
 */
export function shouldSkipSmtpProbe(): boolean {
  if (state.available !== false) return false;
  if (Date.now() - state.blockedAt >= RETRY_AFTER_MS) {
    // Re-test: clear the verdict so the next attempt really dials.
    state.available = null;
    state.consecutiveFailures = 0;
    return false;
  }
  return true;
}

/**
 * Record what happened when something tried to reach a mail server.
 *
 * @param reachable Whether an SMTP conversation actually started. A rejected
 *   recipient counts as reachable — the server answered.
 * @param reason Only used when unreachable, for the message shown to operators.
 */
export function noteSmtpOutcome(reachable: boolean, reason = ''): void {
  if (reachable) {
    state.available = true;
    state.consecutiveFailures = 0;
    state.lastReason = '';
    return;
  }

  state.consecutiveFailures += 1;
  state.lastReason = reason;
  if (state.consecutiveFailures >= FAILURES_BEFORE_GIVING_UP) {
    state.available = false;
    state.blockedAt = Date.now();
  }
}

/** What to tell an operator about why mailbox checks aren't running. */
export function smtpBlockedMessage(): string {
  return (
    'This server cannot open outbound connections on port 25, so mailboxes cannot be checked. ' +
    'Most managed hosts (Render, Heroku, Fly, Vercel) block it to prevent spam, and it is not a setting you can change. ' +
    'Scores reflect syntax and domain checks only.'
  );
}

/**
 * Current view of outbound SMTP, for reporting to the app.
 *
 * `available: null` means nothing has been attempted yet this process — not that
 * it works. Callers must not treat null as available.
 */
export function outboundSmtpStatus(): {
  available: boolean | null;
  consecutive_failures: number;
  last_reason: string;
  retry_after_seconds: number | null;
} {
  const retryAfter =
    state.available === false
      ? Math.max(0, Math.ceil((state.blockedAt + RETRY_AFTER_MS - Date.now()) / 1000))
      : null;

  return {
    available: state.available,
    consecutive_failures: state.consecutiveFailures,
    last_reason: state.available === false ? smtpBlockedMessage() : state.lastReason,
    retry_after_seconds: retryAfter,
  };
}

/** Reset, for tests. */
export function resetSmtpReachability(): void {
  state.available = null;
  state.consecutiveFailures = 0;
  state.blockedAt = 0;
  state.lastReason = '';
}

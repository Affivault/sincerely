/* ═══════════════════════════════════════════════════════════════════════
   What a screen says when it has nothing to show.

   Loading, empty and failed are the same problem wearing three hats, and
   this app improvised all three, per page, fifty-nine times. Five loading
   idioms in live use - shimmering blocks, a Spinner component, a bare
   spinning Loader2, a Skeleton component, and the literal words
   "Loading..." - so every screen resolved differently and the whole app
   flickered in a different dialect depending where you were.

   Empty was worse: an EmptyState component existed and nine files used
   it while twenty-four wrote their own. That is twenty-four tones of
   voice at the exact moment a new account has nothing on screen and most
   needs telling what to do.

   And failure was worst of all. Two hundred and fifty-two toast.error
   calls against three error boundaries in fifty-nine pages, which means
   the normal experience of something going wrong is a message that
   disappears after four seconds, over a blank area, with no way to try
   again.

   This module owns the one decision that has to be consistent: GIVEN A
   FAILURE, WHAT DO WE SAY, AND IS TRYING AGAIN WORTH ANYTHING? It is
   here rather than in a component because the answer must be the same in
   a toast, in a panel and in a route boundary - and because "is this
   retryable" is a judgement that should be testable against real error
   shapes rather than eyeballed.

   THE RULE THAT MATTERS: A RETRY BUTTON ON SOMETHING THAT CANNOT SUCCEED
   IS A LIE. A deleted record, a plan limit, a malformed request - none
   of those get better by pressing a button, and offering one teaches
   people that the button does nothing. Retry is offered where it can
   work, and nowhere else.
   ═══════════════════════════════════════════════════════════════════════ */

export type FailureKind =
  /** No network at all. Nothing reached the server. */
  | 'offline'
  /** It reached the server and gave up waiting. */
  | 'timeout'
  /** Signed out, or the session expired. */
  | 'unauthorised'
  /** Signed in, but not allowed. */
  | 'forbidden'
  /** The thing being asked for is not there. */
  | 'missing'
  /** Asking too fast. */
  | 'rate-limited'
  /** The request itself was wrong. */
  | 'bad-request'
  /** The server broke. */
  | 'server'
  /** Something else. */
  | 'unknown';

export interface FailureDescription {
  kind: FailureKind;
  /** Three or four words. What happened. */
  title: string;
  /** One sentence. What it means and what to do. Never empty. */
  detail: string;
  /**
   * Whether pressing "try again" could plausibly work.
   *
   * False for anything that will fail identically every time. A retry
   * button on a deleted record is a lie, and one lie is enough for
   * somebody to stop trusting every other button.
   */
  retryable: boolean;
  /** The server's own message, when it sent one worth showing. */
  serverMessage?: string;
}

/** Shapes an axios-style error can arrive in, without importing axios. */
interface ErrorLike {
  message?: string;
  code?: string;
  name?: string;
  response?: { status?: number; data?: { error?: string; message?: string; code?: string } };
}

/**
 * The server's own words, when it bothered to send any.
 *
 * Preferred over anything invented here: an API that says "This list is
 * used by two running campaigns" has explained the problem far better
 * than "Something went wrong" ever will.
 */
function serverMessageOf(err: ErrorLike): string | undefined {
  const data = err.response?.data;
  const raw = (data?.error || data?.message || '').trim();
  if (!raw) return undefined;
  // A stack trace or an HTML error page is not a message for a person.
  if (raw.length > 300 || /^<|Error: \w+Error/.test(raw)) return undefined;
  return raw;
}

/**
 * Turn a thrown thing into something worth showing somebody.
 *
 * Deliberately total: it always returns a description, because the one
 * case that must never happen is a failure with no explanation at all.
 */
export function describeFailure(err: unknown): FailureDescription {
  const e = (err ?? {}) as ErrorLike;
  const serverMessage = serverMessageOf(e);
  const status = e.response?.status;

  /*
   * No response at all. Either the network is down or the request never
   * completed - and those read very differently to somebody sitting on a
   * train, so they are not merged into "network error".
   */
  if (!status) {
    const code = (e.code || '').toUpperCase();
    const message = (e.message || '').toLowerCase();

    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || message.includes('timeout')) {
      return {
        kind: 'timeout',
        title: 'Took too long',
        detail: 'The server did not answer in time. It may just be busy.',
        retryable: true,
        serverMessage,
      };
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return {
        kind: 'offline',
        title: 'No connection',
        detail: 'Your device is offline. This will work again as soon as you are back.',
        retryable: true,
      };
    }

    return {
      kind: 'offline',
      title: 'Could not reach the server',
      detail: 'Nothing came back. Check your connection, then try again.',
      retryable: true,
      serverMessage,
    };
  }

  if (status === 401) {
    return {
      kind: 'unauthorised',
      title: 'Signed out',
      detail: 'Your session has expired. Sign in again to carry on.',
      // Retrying the same request with the same dead session is pointless.
      retryable: false,
      serverMessage,
    };
  }

  if (status === 403) {
    return {
      kind: 'forbidden',
      title: 'Not allowed',
      detail: serverMessage || 'Your account does not have access to this.',
      retryable: false,
      serverMessage,
    };
  }

  if (status === 404) {
    return {
      kind: 'missing',
      title: 'Not found',
      detail: serverMessage || 'This no longer exists, or it was never here. It may have been deleted.',
      // The single most important false retry. A deleted record does not
      // come back because somebody pressed a button.
      retryable: false,
      serverMessage,
    };
  }

  if (status === 429) {
    return {
      kind: 'rate-limited',
      title: 'Too many requests',
      detail: serverMessage || 'Slow down for a moment, then try again.',
      retryable: true,
      serverMessage,
    };
  }

  if (status >= 400 && status < 500) {
    return {
      kind: 'bad-request',
      title: 'That did not work',
      detail: serverMessage || 'The request was not something the server could accept.',
      /*
       * A malformed request fails identically every time. Offering a
       * retry here is the same lie as offering one on a 404 - the only
       * thing that helps is changing what was sent.
       */
      retryable: false,
      serverMessage,
    };
  }

  return {
    kind: 'server',
    title: 'Something broke',
    detail: serverMessage || 'The server ran into a problem. This is usually temporary.',
    retryable: true,
    serverMessage,
  };
}

/**
 * The one line to show in a toast.
 *
 * Same decision as the panel, shortened. A failure that reads one way in
 * a toast and another in a panel is two explanations of one event, and
 * somebody has to work out whether they are the same thing.
 */
export function failureToast(err: unknown, fallback?: string): string {
  const d = describeFailure(err);
  if (d.serverMessage) return d.serverMessage;
  if (fallback && d.kind === 'unknown') return fallback;
  return `${d.title} — ${d.detail}`;
}

/**
 * Should react-query keep retrying this by itself?
 *
 * Retrying a 404 three times is three round trips to be told the same
 * thing, and it delays the moment somebody finds out. The default retry
 * policy has no idea what the status was; this does.
 */
export function shouldAutoRetry(failureCount: number, err: unknown, max = 2): boolean {
  if (failureCount >= max) return false;
  return describeFailure(err).retryable;
}

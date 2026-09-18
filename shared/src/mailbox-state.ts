/* ═══════════════════════════════════════════════════════════════════════
   What is actually wrong with this mailbox, in one sentence.

   The list used to answer that with six signals at once: a coloured dot, a
   "Domain auth" chip, a "Status" chip, a "Warm-up" chip, a deliverability
   percentage and a sends counter. Between them they managed not to say the
   only thing anybody opens this screen to find out - whether the mailbox
   can send and receive - and they said it so confidently that three
   mailboxes sat there showing Verified, Authenticated and 100% while none
   of them could receive a reply and one could not send at all.

   Six indicators that can all be green while the thing is broken are not
   six indicators. They are decoration.

   So: one state, resolved in one place, ordered by what stops you first.
   Sending before receiving, because a mailbox that cannot send is not a
   mailbox yet. Receiving before the domain, because mail that arrives in
   spam is still mail and a reply you never see is gone. The domain before
   warm-up, because warm-up is a choice and authentication is not.

   It lives in shared and takes plain values so it can be asserted against
   real rows rather than by reading a component and hoping.
   ═══════════════════════════════════════════════════════════════════════ */

export type MailboxTone = 'broken' | 'warning' | 'ready' | 'idle';

export interface MailboxState {
  tone: MailboxTone;
  /** Two or three words. The whole status, if you read nothing else. */
  label: string;
  /** One sentence saying what it means, or empty when the label suffices. */
  detail: string;
  /** The single most useful thing to do next, or null when nothing is. */
  action: null | 'fix-connection' | 'set-imap' | 'authenticate-domain' | 'verify';
}

export interface MailboxFacts {
  is_active: boolean;
  is_verified: boolean;
  /** Null or empty means replies cannot be read at all. */
  imap_host?: string | null;
  /** The mailbox's own unresolved sync failure, when there is one. */
  sync_error?: string | null;
  /** Whether the sending domain has passing SPF/DKIM/DMARC. */
  domain_verified?: boolean;
  /** Whether a sending domain exists for this address at all. */
  domain_known?: boolean;
  warmup_mode?: boolean;
}

/**
 * Resolve a mailbox to the one thing worth saying about it.
 *
 * Deliberately ordered, and deliberately returns exactly one state: a list
 * where every row says one thing is a list you can scan. A row that says
 * five things is a row you have to read.
 */
export function resolveMailboxState(m: MailboxFacts): MailboxState {
  if (!m.is_active) {
    return {
      tone: 'idle',
      label: 'Paused',
      detail: 'This mailbox is switched off and will not send.',
      action: null,
    };
  }

  /*
   * An unresolved sync failure outranks everything, because it is the only
   * signal here that came from actually trying something rather than from
   * a stored flag. A repair note is not a failure - it says something was
   * already put right - so it is not treated as one.
   */
  const failure = (m.sync_error || '').trim();
  if (failure && !failure.startsWith('Fixed automatically:')) {
    return {
      tone: 'broken',
      label: 'Not receiving',
      detail: failure,
      action: 'fix-connection',
    };
  }

  if (!m.is_verified) {
    return {
      tone: 'warning',
      label: 'Not tested',
      detail: 'Nobody has checked this mailbox can send. Test it before a campaign does.',
      action: 'verify',
    };
  }

  // Sending works and nothing has failed. Now the gaps, in the order they
  // cost you something.
  if (!(m.imap_host || '').trim()) {
    return {
      tone: 'warning',
      label: 'Send only',
      detail: 'No mailbox server is set, so replies will not reach your inbox.',
      action: 'set-imap',
    };
  }

  if (!m.domain_verified) {
    return {
      tone: 'warning',
      label: m.domain_known ? 'Domain unverified' : 'Domain not added',
      detail: m.domain_known
        ? 'SPF, DKIM and DMARC are not all passing, so more of this mail lands in spam.'
        : 'This domain has no authentication records, so more of this mail lands in spam.',
      action: 'authenticate-domain',
    };
  }

  return {
    tone: 'ready',
    label: m.warmup_mode ? 'Warming up' : 'Ready',
    detail: m.warmup_mode
      ? 'Sending a limited amount each day while the mailbox builds a reputation.'
      : '',
    action: null,
  };
}

/**
 * A reputation score, or nothing at all.
 *
 * health_score starts at 100 and only moves when something bounces, so a
 * mailbox that has never sent a message displayed a confident green 100% -
 * a number with no evidence behind it, in the largest type in the row. A
 * measurement that cannot yet have been measured should not be shown, and
 * "no data" is a perfectly good thing for a new mailbox to say.
 */
export function mailboxScore(m: { health_score: number; total_sent: number }): number | null {
  return m.total_sent > 0 ? m.health_score : null;
}

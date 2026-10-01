/* ═══════════════════════════════════════════════════════════════════════
   Does a reply really stop the sequence?

   The promise this product cannot break: somebody who answers does not get
   the next email. Sync, matching and stopping were each tested alone; this
   proves them together, on the account's real mailboxes:

     sent        one mailbox sends a check email to another (or to itself)
     replied     the other answers it, threaded the way a person's would be
     arrived     inbox sync finds the answer in the first mailbox
     matched     it is matched to the send it answers
     stopped     the enrolment is stopped as replied

   The check rides in on a hidden draft campaign and a placeholder contact,
   both removed when it ends, and is marked with a header so that nothing
   else reacts to it: it is never stored in the inbox, never read by Relay,
   never sent to Slack or webhooks as a reply.
   ═══════════════════════════════════════════════════════════════════════ */

/** The check's placeholder campaign and contact, hidden from lists while it runs. */
export const REPLY_CHECK_CAMPAIGN_NAME = '[Sincerely] Reply check - removed automatically';
export const REPLY_CHECK_CONTACT_DOMAIN = 'reply-check.invalid';

/** Marks mail the platform sends to itself. Never stored, never acted on. */
export const SYSTEM_MAIL_HEADER = 'X-Sincerely-System';

export type SystemMailKind = 'reply-check' | 'notice';

/** "reply-check 1a2b..." or "notice" from the header value. */
export function readSystemMailHeader(value: unknown): { kind: SystemMailKind; token: string | null } | null {
  const v = String(Array.isArray(value) ? value[0] : value ?? '').trim();
  if (!v) return null;
  const [kind, token] = v.split(/\s+/);
  if (kind === 'reply-check') return { kind, token: /^[a-f0-9]{16,32}$/.test(token || '') ? token : null };
  if (kind === 'notice') return { kind, token: null };
  return null;
}

/** The subject carries the token too, for providers that strip unknown headers. */
export function replyCheckSubject(token: string): string {
  return `Sincerely reply check [${token}]`;
}

export function replyCheckTokenIn(subject: string | null | undefined): string | null {
  const m = /Sincerely reply check \[([a-f0-9]{16,32})\]/.exec(subject || '');
  return m ? m[1] : null;
}

export const REPLY_CHECK_STAGES = ['sent', 'replied', 'arrived', 'matched', 'stopped'] as const;
export type ReplyCheckStage = typeof REPLY_CHECK_STAGES[number];

export const REPLY_CHECK_STAGE_LABELS: Record<ReplyCheckStage, string> = {
  sent: 'Check email sent',
  replied: 'Answered by the other mailbox',
  arrived: 'Answer found by inbox sync',
  matched: 'Matched to the email it answers',
  stopped: 'Sequence stopped',
};

/** How long a check waits for the answer to come back through IMAP. */
export const REPLY_CHECK_WAIT_MS = 100_000;
/** How often the automatic check runs for each account. */
export const REPLY_CHECK_EVERY_MS = 24 * 3_600_000;

export interface ReplyCheckResult {
  ok: boolean;
  /** Not run, and not a failure: e.g. no mailbox can read its inbox. */
  skipped: boolean;
  /** The stages reached, in order. */
  reached: ReplyCheckStage[];
  /** The first stage that did not happen, when it failed. */
  failed_at: ReplyCheckStage | null;
  detail: string;
  from_mailbox: string | null;
  to_mailbox: string | null;
  seconds: number | null;
  ran_at: string;
}

/** What to tell somebody about the stage that did not happen. */
export function explainReplyCheckFailure(stage: ReplyCheckStage, ctx: { from: string; to: string; error?: string | null }): string {
  switch (stage) {
    case 'sent':
      return `${ctx.from} could not send the check email${ctx.error ? `: ${ctx.error}` : '.'}`;
    case 'replied':
      return `${ctx.to} could not send its answer${ctx.error ? `: ${ctx.error}` : '.'}`;
    case 'arrived':
      return `The answer never reached ${ctx.from}'s inbox as far as inbox sync can see. Either delivery is slow, it went to spam, or inbox sync is not reading new mail. Until this passes, replies may not stop sequences.`;
    case 'matched':
      return `Inbox sync found the answer but could not match it to the email it answers, so a real reply like it would not stop a sequence.`;
    case 'stopped':
      return `The answer was matched, but the enrolment was not stopped - a real reply like it would not stop the sequence.`;
  }
}

/** Whether an account's automatic check is due. */
export function replyCheckDue(lastRunAt: string | null | undefined, now = Date.now()): boolean {
  if (!lastRunAt) return true;
  const t = Date.parse(lastRunAt);
  return !Number.isFinite(t) || now - t >= REPLY_CHECK_EVERY_MS;
}

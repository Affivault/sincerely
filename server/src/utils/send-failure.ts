/* ═══════════════════════════════════════════════════════════════════════
   Was that a bounce, or just a bad day?

   The distinction decides a great deal: a bounce marks the contact
   permanently undeliverable across every campaign, degrades the mailbox's
   health score, counts toward the bounce rate, and can trip the guard that
   stops a campaign burning the sending domain. A transient failure should
   do none of those things.

   It used to be decided inline, against fields only the direct SMTP path
   ever sets. Sends through the relay throw a plain Error with no
   responseCode, so a hard "550 User unknown" was filed as a generic error:
   the address stayed live and kept being mailed by other campaigns, the
   bounce rate under-reported, and the bounce guard could never fire. The
   relay is the *recommended* deployment, so on a correctly configured
   install bounce handling was effectively switched off.

   One classifier now, used by both paths, reading the response code from
   wherever it is available — including out of the message text, which is
   the only place the relay puts it.
   ═══════════════════════════════════════════════════════════════════════ */

export type SendFailureKind = 'bounce' | 'transient' | 'auth' | 'unknown';

/**
 * SMTP codes that mean *we* failed to authenticate, not that the recipient
 * is undeliverable (RFC 4954): 530 auth required, 534 mechanism too weak,
 * 535 credentials rejected, 538 encryption required. They are 5xx, so a
 * naive "5xx is permanent" reading marks the contact bounced — removing a
 * live prospect from every future campaign because a password expired.
 */
const AUTH_CODES = new Set([530, 534, 535, 538]);

/**
 * The SMTP reply code behind a failure, from whichever field carries it.
 *
 * nodemailer sets `responseCode` as a number; the relay only has the
 * server's reply text, which by RFC 5321 opens with the three-digit code.
 * That is the whole rule: the code *starts* the reply. So the text is split
 * on the delimiters that prefix a wrapped reply — line breaks, and the colon
 * in "Invalid login: 535 ..." or "SMTP relay error: 550 ..." — and the code
 * must begin a segment. A number sitting mid-sentence is prose, not a reply
 * code, and "Processed 550 contacts successfully" is no longer read as a
 * hard bounce.
 */
export function smtpResponseCode(err: any): number | null {
  const direct = Number(err?.responseCode);
  if (Number.isFinite(direct) && direct >= 200 && direct <= 599) return direct;

  for (const text of [err?.response, err?.message, String(err || '')]) {
    if (typeof text !== 'string') continue;
    for (const segment of text.split(/[\r\n:]+/)) {
      const m = /^([245]\d{2})(?:[\s.-]|$)/.exec(segment.trim());
      if (m) return Number(m[1]);
    }
  }
  return null;
}

/**
 * Classify a failed send.
 *
 * 5xx is permanent — the address is wrong, the mailbox is gone, the domain
 * does not exist. 4xx is the server asking to be tried later (greylisting,
 * a full mailbox, rate limiting) and must never mark a contact bounced.
 * EENVELOPE means the address was rejected before a conversation started.
 *
 * `auth` is carved out of 5xx because it is the one permanent failure that
 * says nothing about the recipient: the mailbox refused *our* login. Every
 * send from that account fails identically, so treating it as a bounce
 * would burn through the campaign marking healthy prospects dead.
 *
 * Anything unrecognised is `unknown` rather than `bounce`: wrongly marking
 * a real prospect undeliverable removes them from every future campaign,
 * which is a worse mistake than retrying a send.
 */
export function classifySendFailure(err: any): SendFailureKind {
  // nodemailer's own verdict on a login failure, which it reaches without
  // always leaving a reply code behind.
  if (err?.code === 'EAUTH') return 'auth';
  if (err?.code === 'EENVELOPE') return 'bounce';

  const code = smtpResponseCode(err);
  if (code === null) return 'unknown';
  if (AUTH_CODES.has(code)) return 'auth';
  if (code >= 500) return 'bounce';
  if (code >= 400) return 'transient';
  return 'unknown';
}

/** Convenience for the send path, which only asks the one question. */
export function isBounceFailure(err: any): boolean {
  return classifySendFailure(err) === 'bounce';
}

/**
 * A stall reason for the failures only the account owner can clear.
 *
 * A campaign whose mailbox credentials have gone stale will otherwise sit
 * there marking contact after contact as errored with nothing on the
 * campaign page explaining why — the one failure worth interrupting for.
 */
export function stallReasonFor(kind: SendFailureKind): string | null {
  if (kind !== 'auth') return null;
  return 'Your mailbox rejected the login. Update the password (or app password) on this sending account, then resume the campaign.';
}

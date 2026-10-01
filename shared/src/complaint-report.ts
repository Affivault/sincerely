/* ═══════════════════════════════════════════════════════════════════════
   Spam complaints that arrive as email.

   When somebody presses "Report spam", the mailbox provider does not tell
   the sender - unless the sender's domain is registered with its feedback
   loop (Yahoo's Complaint Feedback Loop, Microsoft's JMRP, and the many
   providers that use the same format). Then a report arrives in a mailbox
   of your choosing: an Abuse Reporting Format message (RFC 5965) with a
   machine-readable part and a copy of the original email.

   This reads one. Who complained is found three ways, best first:

     1. the X-Sincerely-Contact / -Campaign headers every campaign email
        carries, copied into the report with the original message
     2. the original's Message-ID, which matches the send it came from
     3. Original-Rcpt-To, when the provider has not redacted it

   Providers often redact the recipient, which is why the headers come
   first. A "not-spam" report is the opposite of a complaint and is ignored.

   Pure: text in, findings out.
   ═══════════════════════════════════════════════════════════════════════ */

export type FeedbackType = 'abuse' | 'fraud' | 'virus' | 'other' | 'not-spam';

export interface ComplaintReport {
  feedbackType: FeedbackType;
  /** Who sent the report, e.g. "Yahoo", "Microsoft", or the reporting domain. */
  provider: string;
  /** From the original's X-Sincerely-* headers, when they survived. */
  contactId: string | null;
  campaignId: string | null;
  stepId: string | null;
  /** The original message's Message-ID, angle brackets included. */
  originalMessageId: string | null;
  /** The person who complained, when not redacted. Lowercase. */
  recipient: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Senders of feedback-loop reports that do not always use multipart/report. */
const KNOWN_LOOPS: Array<{ re: RegExp; name: string }> = [
  { re: /@(arf\.mail\.yahoo\.com|yahoo-inc\.com|feedback\.yahoo\.com)$/i, name: 'Yahoo' },
  { re: /^staff@hotmail\.com$|@(.*\.)?(microsoft|outlook|hotmail)\.com$/i, name: 'Microsoft' },
  { re: /@(.*\.)?(comcast\.net|cox\.net|fastmail\.com|zoho\.com|mail\.ru|yandex\.ru|gmx\.net|web\.de)$/i, name: '' },
];

function providerFor(fromEmail: string, reportedDomain: string | null): string {
  const from = (fromEmail || '').trim().toLowerCase();
  for (const l of KNOWN_LOOPS) {
    if (l.re.test(from)) return l.name || from.split('@')[1] || 'A mailbox provider';
  }
  if (reportedDomain) return reportedDomain;
  return from.split('@')[1] || 'A mailbox provider';
}

/** The value of the first header line named `name` (case-insensitive), unfolded. */
function headerValue(text: string, name: string): string | null {
  const re = new RegExp(`^${name.replace(/-/g, '\\-')}:[ \\t]*(.*(?:\\r?\\n[ \\t]+.*)*)`, 'im');
  const m = re.exec(text);
  if (!m) return null;
  return m[1].replace(/\r?\n[ \t]+/g, ' ').trim() || null;
}

/** Every value of header `name`, in order. */
function headerValues(text: string, name: string): string[] {
  const re = new RegExp(`^${name.replace(/-/g, '\\-')}:[ \\t]*(.*(?:\\r?\\n[ \\t]+.*)*)`, 'gim');
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const v = m[1].replace(/\r?\n[ \t]+/g, ' ').trim();
    if (v) out.push(v);
  }
  return out;
}

function addressIn(value: string | null): string | null {
  if (!value) return null;
  const m = /<?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>?/i.exec(value);
  return m ? m[1].toLowerCase() : null;
}

/** Whether a message looks like a feedback-loop report at all. Cheap. */
export function looksLikeComplaintReport(input: { fromEmail?: string | null; subject?: string | null; contentType?: string | null; text?: string | null }): boolean {
  if (/report-type\s*=\s*"?feedback-report/i.test(input.contentType || '')) return true;
  const text = input.text || '';
  if (/^Feedback-Type:\s*(abuse|fraud|virus|other)\b/im.test(text)) return true;
  // Microsoft's JMRP: from staff@hotmail.com, the original attached, no ARF part.
  const from = (input.fromEmail || '').toLowerCase();
  return /^staff@hotmail\.com$/.test(from) && /complaint/i.test(input.subject || '');
}

/**
 * Read a feedback-loop report. `text` is everything readable in it - the
 * body plus the decoded feedback-report and original-message parts - so a
 * report whose parts arrive as attachments is read the same way.
 * Returns null for anything that is not a complaint.
 */
export function parseComplaintReport(input: {
  fromEmail: string;
  subject?: string | null;
  contentType?: string | null;
  text: string;
}): ComplaintReport | null {
  const text = (input.text || '').slice(0, 400_000);
  if (!looksLikeComplaintReport({ ...input, text })) return null;

  const rawType = (headerValue(text, 'Feedback-Type') || 'abuse').toLowerCase().split(/[\s;]/)[0];
  const feedbackType: FeedbackType = (['abuse', 'fraud', 'virus', 'other', 'not-spam'] as const)
    .find((t) => t === rawType) || 'abuse';
  if (feedbackType === 'not-spam') return null;

  // The original message's own headers. A report carries several
  // Message-IDs - the report's own first - so prefer the one beside our
  // campaign headers, then the last one, which is the original's.
  const contactId = headerValue(text, 'X-Sincerely-Contact');
  const campaignId = headerValue(text, 'X-Sincerely-Campaign');
  const stepId = headerValue(text, 'X-Sincerely-Step');
  const ids = headerValues(text, 'Message-ID').map((v) => (/<[^>]+>/.exec(v)?.[0] ?? `<${v.replace(/[<>]/g, '')}>`));
  const originalMessageId = ids.length > 1 ? ids[ids.length - 1] : ids[0] || null;

  const reportedDomain = (headerValue(text, 'Reported-Domain') || '').toLowerCase() || null;
  const recipient = addressIn(headerValue(text, 'Original-Rcpt-To'));

  return {
    feedbackType,
    provider: providerFor(input.fromEmail, reportedDomain),
    contactId: contactId && UUID.test(contactId) ? contactId.toLowerCase() : null,
    campaignId: campaignId && UUID.test(campaignId) ? campaignId.toLowerCase() : null,
    stepId: stepId && UUID.test(stepId) ? stepId.toLowerCase() : null,
    originalMessageId: ids.length ? originalMessageId : null,
    recipient,
  };
}

/** The last 30 days of complaints, for the Autopilot page. */
export interface ComplaintSummary {
  items: Array<{ id: string; at: string; email: string | null; provider: string | null; campaign_id: string; campaign_name: string | null; mailbox: string | null }>;
  /** Complaints in the last 30 days (up to 50). */
  total: number;
  /** Sends in the same 30 days. */
  sent: number;
}

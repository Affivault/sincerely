/* ═══════════════════════════════════════════════════════════════════════
   When somebody does not turn up.

   A no-show is usually not a no: a train, a clash, a calendar that never
   synced. The meetings that get rescued are the ones followed up within
   the hour with a way to pick a new time, and the ones that are lost are
   the ones where the organiser felt awkward and wrote nothing.

   So marking a meeting as a no-show offers that email straight away, and
   can send it on its own if the account has said so. The wording is the
   account's to change; the tags below are filled in from the meeting.
   ═══════════════════════════════════════════════════════════════════════ */

/** The tags a no-show template understands, with what each becomes. */
export const NO_SHOW_TAGS: { tag: string; hint: string }[] = [
  { tag: 'first_name', hint: 'Their first name' },
  { tag: 'meeting', hint: 'What the meeting was called' },
  { tag: 'meeting_date', hint: 'When it was, in their time zone' },
  { tag: 'organiser', hint: 'Your name' },
  { tag: 'booking_link', hint: 'Your booking page, to pick a new time' },
];

export const DEFAULT_NO_SHOW_SUBJECT = 'Sorry we missed you - want to find another time?';

export const DEFAULT_NO_SHOW_BODY = [
  'Hi {{first_name|there}},',
  '',
  'Looks like we missed each other for {{meeting}} on {{meeting_date}}. No problem at all - these things happen.',
  '',
  'If you would still like to talk, pick whatever time suits you here:',
  '{{booking_link}}',
  '',
  'Best,',
  '{{organiser}}',
].join('\n');

export interface NoShowValues {
  first_name?: string | null;
  meeting?: string | null;
  meeting_date?: string | null;
  organiser?: string | null;
  booking_link?: string | null;
}

/**
 * Fill a template. `{{tag}}` or `{{tag|fallback}}`; an unknown tag is left
 * as typed, so a typo shows up in the preview instead of vanishing.
 */
export function renderNoShowTemplate(template: string, values: NoShowValues): string {
  return String(template ?? '').replace(/\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/gi, (whole, name: string, fallback?: string) => {
    const key = name.toLowerCase() as keyof NoShowValues;
    if (!NO_SHOW_TAGS.some((t) => t.tag === key)) return whole;
    const v = values[key];
    if (v !== null && v !== undefined && String(v).trim() !== '') return String(v);
    return (fallback ?? '').trim();
  });
}

/** Tags a template uses that this feature does not know about. */
export function unknownNoShowTags(template: string): string[] {
  const out = new Set<string>();
  for (const m of String(template ?? '').matchAll(/\{\{\s*([a-z_]+)\s*(?:\|[^}]*)?\}\}/gi)) {
    if (!NO_SHOW_TAGS.some((t) => t.tag === m[1].toLowerCase())) out.add(m[1]);
  }
  return [...out];
}

/** What the server says back after a meeting is marked as a no-show. */
export interface NoShowOutcome {
  event_id: string;
  /**
   * sent        - the follow-up went out on its own (auto-send is on)
   * offer       - it can be sent; the app should offer it
   * already     - one was already sent for this meeting
   * unavailable - it cannot be sent, and `reason` says why
   */
  followup: 'sent' | 'offer' | 'already' | 'unavailable';
  reason?: string;
}

export interface NoShowPreview {
  to: string;
  subject: string;
  body: string;
  booking_link: string | null;
  already_sent_at: string | null;
}

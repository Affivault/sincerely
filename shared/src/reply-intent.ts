/* ═══════════════════════════════════════════════════════════════════════
   What a reply is, in words - said the same way everywhere.

   Relay sorts every reply into one of a handful of intents, and each screen
   that showed one had written its own labels. They disagreed: the dashboard
   said "Not now" where the Unibox said "Not Interested" for the same reply,
   and a prospect asking for a call was "Meeting Booked" in the Unibox, which
   told people a meeting existed when nobody had booked anything. A label
   that changes between screens reads as two different facts.

   Sentence case, like the rest of the app. `short` is for tight chips.
   ═══════════════════════════════════════════════════════════════════════ */

export interface ReplyIntentLabel {
  label: string;
  short: string;
}

export const REPLY_INTENT_LABELS: Record<string, ReplyIntentLabel> = {
  interested:    { label: 'Interested',      short: 'Interested' },
  meeting:       { label: 'Wants a meeting', short: 'Meeting' },
  objection:     { label: 'Objection',       short: 'Objection' },
  not_now:       { label: 'Not now',         short: 'Not now' },
  question:      { label: 'Question',        short: 'Question' },
  unsubscribe:   { label: 'Unsubscribe',     short: 'Unsub' },
  out_of_office: { label: 'Out of office',   short: 'Away' },
  bounce:        { label: 'Bounced',         short: 'Bounced' },
  other:         { label: 'Other',           short: 'Other' },
};

/** The words for an intent; an unknown or missing one reads as a plain reply. */
export function replyIntentLabel(intent: string | null | undefined, form: 'label' | 'short' = 'label'): string {
  const hit = intent ? REPLY_INTENT_LABELS[intent] : undefined;
  return hit ? hit[form] : 'Reply';
}

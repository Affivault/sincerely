/* ═══════════════════════════════════════════════════════════════════════
   Which step earns the replies.

   The step table already showed what happened at each step. It could not
   answer the question anybody actually has, which is whether to keep
   sending step five — and the numbers on that table quietly argue the wrong
   way. A follow-up's reply *rate* is computed over the survivors: everyone
   who replied or bounced or unsubscribed has already left, so the pool
   shrinks at every step and the rate flatters whatever is last. Step five
   showing 11% off eighteen sends looks like the best step in the sequence
   and is two replies.

   So this reports the two things a decision needs. What share of the
   campaign's replies each step actually produced — which does not shrink
   with the pool — and how confident we are in the rate, using the same
   Wilson interval the bounce guard judges on. A step is only called
   unproductive when even the optimistic reading of its rate is well below
   what the rest of the campaign manages.
   ═══════════════════════════════════════════════════════════════════════ */

export type StepVerdict =
  /** Producing replies at a rate worth the sends. */
  | 'earning'
  /** Working, but well behind the rest of the sequence. */
  | 'marginal'
  /** Confidently below what the campaign manages elsewhere. */
  | 'unproductive'
  /** Too few sends to say anything at all. */
  | 'too_early';

export interface SequenceStepPerformance {
  step_id: string;
  step_number: number;
  subject: string;
  delay_days: number;

  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  unsubscribed: number;

  /** Of every reply this campaign earned, the share this step produced. 0-1. */
  share_of_replies: number;
  /** replied / sent. 0-1. */
  reply_rate: number;
  /** The lowest that rate plausibly is, given the sample. 0-1. */
  confident_reply_rate: number;
  /** Replies earned per hundred emails this step cost to send. */
  replies_per_100: number;
  /** Typical gap between the step landing and a reply to it. */
  median_hours_to_reply: number | null;

  verdict: StepVerdict;
  /** One line explaining the verdict in the reader's terms. */
  note: string;
}

export interface SequencePerformance {
  total_sent: number;
  total_replied: number;
  steps: SequenceStepPerformance[];
  /**
   * The step number the sequence could stop at without losing replies, or
   * null when there is not enough evidence to suggest one.
   */
  recommended_length: number | null;
  /** One sentence naming what to do about it. */
  headline: string;
}

export const STEP_VERDICT_LABELS: Record<StepVerdict, string> = {
  earning: 'Earning',
  marginal: 'Marginal',
  unproductive: 'Not earning',
  too_early: 'Too early',
};

/** Below this many sends, a step's rate is not evidence of anything. */
export const MIN_STEP_SENDS = 25;

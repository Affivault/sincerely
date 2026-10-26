/* ═══════════════════════════════════════════════════════════════════════
   Sending health: one verdict per mailbox.

   Everything that decides whether a mailbox's mail lands was already
   measured somewhere - the pace on the mailbox, the warm-up ramp, the
   autopilot's rests, the domain's DNS, the placement tests - but each on
   its own page, so "is this mailbox all right?" took five tabs to answer
   and nobody answered it until something broke.

   This reads all of it and says one of three things:

     healthy   nothing to do
     watch     something is drifting; worth a look this week
     at_risk   mail from it is being refused or filtered, or will be

   with the reason in a sentence and the one step most likely to help.
   The worst finding wins, and the first finding of that severity is the
   one shown, so the rules below are in the order a person should fix
   things: a mailbox that cannot sign in is not helped by better DNS.

   Pure: facts in, verdict out. The server gathers the facts.
   ═══════════════════════════════════════════════════════════════════════ */

import { judgeMailbox, type AutopilotState } from './autopilot.js';
import { RECOMMENDED_DAILY_LIMIT, formatGap } from './sending-pace.js';
import type { PlacementVerdict } from './placement.js';

export type SendingHealthStatus = 'healthy' | 'watch' | 'at_risk';

/** What the one-click next step does; the client turns it into a link or an action. */
export type SendingHealthStepKind =
  | 'reconnect'
  | 'authenticate_domain'
  | 'view_autopilot'
  | 'slow_pace'
  | 'run_placement'
  | 'start_warmup'
  | 'none';

export interface SendingHealthStep {
  kind: SendingHealthStepKind;
  label: string;
}

export interface SendingHealthDay {
  /** YYYY-MM-DD, UTC. */
  date: string;
  sent: number;
  bounced: number;
  complained: number;
}

export interface SendingHealthDomain {
  domain: string;
  /** The sending_domains row, when the domain has been added. */
  domain_id: string | null;
  /** False when the domain has never been checked here. */
  checked: boolean;
  spf: boolean;
  dkim: boolean;
  dmarc: boolean;
  last_checked_at: string | null;
}

export interface SendingHealthPlacement {
  test_id: string;
  at: string;
  verdict: PlacementVerdict;
  inbox_rate: number | null;
  headline: string;
}

export interface SendingHealthFacts {
  is_active: boolean;
  is_verified: boolean;
  last_send_error: string | null;
  created_at: string | null;
  daily_send_limit: number;
  gap_min: number;
  gap_max: number;
  warmup_on: boolean;
  autopilot_state: AutopilotState;
  autopilot_reason: string | null;
  /** Fourteen days of sends and refusals from this mailbox. */
  sent_14d: number;
  bounced_14d: number;
  blocked_14d: number;
  complained_14d: number;
  domain: SendingHealthDomain;
  placement: SendingHealthPlacement | null;
}

export interface SendingHealthVerdict {
  status: SendingHealthStatus;
  /** The one sentence shown beside the status. */
  reason: string;
  /** Every finding, worst first. */
  findings: { status: SendingHealthStatus; text: string }[];
  next_step: SendingHealthStep;
}

export interface MailboxHealth {
  id: string;
  label: string;
  email_address: string;
  is_active: boolean;
  is_verified: boolean;
  sends_today: number;
  daily_send_limit: number;
  /** What it may send today with warm-up and autopilot applied (0 = uncapped). */
  allowance_today: number;
  gap_min: number;
  gap_max: number;
  next_send_allowed_at: string | null;
  warmup: { on: boolean; day: number; ramp_days: number; allowance: number; target: number; complete: boolean };
  autopilot: { state: AutopilotState; reason: string | null; rest_until: string | null };
  totals_14d: { sent: number; bounced: number; blocked: number; complained: number; bounce_rate: number; complaint_rate: number };
  trend: SendingHealthDay[];
  domain: SendingHealthDomain;
  placement: SendingHealthPlacement | null;
  health: SendingHealthVerdict;
}

export interface SendingHealthReport {
  generated_at: string;
  mailboxes: MailboxHealth[];
  counts: Record<SendingHealthStatus, number>;
  /** False when the placement tables are missing, so "no tests" is not read as "tested, nothing found". */
  placement_available: boolean;
}

const RANK: Record<SendingHealthStatus, number> = { healthy: 0, watch: 1, at_risk: 2 };

/** A new mailbox is one younger than this, for the warm-up nudge. */
const NEW_MAILBOX_DAYS = 14;

export function judgeSendingHealth(f: SendingHealthFacts, now: Date = new Date()): SendingHealthVerdict {
  const found: { status: SendingHealthStatus; text: string; step: SendingHealthStep }[] = [];
  const add = (status: SendingHealthStatus, text: string, step: SendingHealthStep) => found.push({ status, text, step });

  const reconnect: SendingHealthStep = { kind: 'reconnect', label: 'Open the mailbox' };
  const fixDomain: SendingHealthStep = { kind: 'authenticate_domain', label: f.domain.domain_id ? 'Fix the DNS records' : 'Check the domain' };
  const autopilot: SendingHealthStep = { kind: 'view_autopilot', label: 'See what the autopilot saw' };
  const slow: SendingHealthStep = { kind: 'slow_pace', label: 'Set a careful pace' };
  const placement: SendingHealthStep = { kind: 'run_placement', label: 'Run a placement test' };

  // Can it send at all?
  if (f.last_send_error) add('at_risk', `Sending was refused last time: ${f.last_send_error}`, reconnect);
  else if (!f.is_verified) add('at_risk', 'The connection test has not passed, so nothing is sent from it.', reconnect);
  if (!f.is_active) add('watch', 'Switched off, so campaigns do not send from it.', reconnect);

  // What the autopilot has already decided.
  if (f.autopilot_state === 'resting') {
    add('at_risk', `Resting${f.autopilot_reason ? `: ${f.autopilot_reason}` : ' after refusals'}. Its campaigns carry on through the other mailboxes.`, autopilot);
  } else if (f.autopilot_state === 'slowed') {
    add('watch', `Slowed to half speed${f.autopilot_reason ? `: ${f.autopilot_reason}` : ''}.`, autopilot);
  } else if (f.autopilot_state === 'recovering') {
    add('watch', 'Coming back from a rest at part speed.', autopilot);
  }

  // The same rules the autopilot uses, over two weeks rather than one.
  const judged = judgeMailbox({ sent: f.sent_14d, bounced: f.bounced_14d, blocked: f.blocked_14d, complained: f.complained_14d });
  if (judged.verdict === 'rest' && f.autopilot_state !== 'resting') add('at_risk', `In the last 14 days, ${judged.reason}.`, slow);
  else if (judged.verdict === 'slow' && f.autopilot_state === 'active') add('watch', `In the last 14 days, ${judged.reason}.`, slow);

  // The domain vouching for it.
  const d = f.domain;
  if (!d.checked) {
    add('watch', `${d.domain} has not been checked here, so SPF, DKIM and DMARC are unknown.`, fixDomain);
  } else {
    const missing = [!d.spf && 'SPF', !d.dkim && 'DKIM'].filter(Boolean) as string[];
    if (missing.length) add('at_risk', `${d.domain} is missing ${missing.join(' and ')}, which most providers now require.`, fixDomain);
    else if (!d.dmarc) add('watch', `${d.domain} has no DMARC record. Gmail and Yahoo expect one from bulk senders.`, fixDomain);
  }

  // Where its mail actually landed.
  const p = f.placement;
  if (p && p.verdict === 'poor') add('at_risk', `The last placement test: ${p.headline}`, placement);
  else if (p && p.verdict === 'mixed') add('watch', `The last placement test: ${p.headline}`, placement);

  // How fast it is set to send.
  if (f.daily_send_limit === 0) add('watch', 'It has no daily limit, so one busy campaign can send far more than reads as a person.', slow);
  else if (f.daily_send_limit > RECOMMENDED_DAILY_LIMIT * 4) add('watch', `A limit of ${f.daily_send_limit} a day is well above the ${RECOMMENDED_DAILY_LIMIT} recommended for one mailbox.`, slow);
  if (f.gap_max < 60) add('watch', `A gap of ${formatGap(f.gap_min, f.gap_max)} between emails sends in bursts providers notice.`, slow);

  // A new mailbox with no warm-up.
  const ageDays = f.created_at ? (now.getTime() - Date.parse(f.created_at)) / 86_400_000 : Infinity;
  if (!f.warmup_on && ageDays < NEW_MAILBOX_DAYS && f.is_verified) {
    add('watch', 'New and not warming up, so it has no sending reputation yet.', { kind: 'start_warmup', label: 'Start warm-up' });
  }

  if (found.length === 0) {
    const what = f.sent_14d > 0
      ? `${f.sent_14d.toLocaleString('en-US')} sent in 14 days with ${f.bounced_14d + f.blocked_14d === 0 ? 'no bounces' : `${f.bounced_14d + f.blocked_14d} bounced`} and no spam reports.`
      : 'Connected, authenticated and paced. Nothing sent in the last 14 days.';
    const next: SendingHealthStep = p ? { kind: 'none', label: '' } : placement;
    return { status: 'healthy', reason: what, findings: [], next_step: next };
  }

  // Stable sort keeps the order above within a severity.
  const sorted = found.map((x, i) => ({ ...x, i })).sort((a, b) => RANK[b.status] - RANK[a.status] || a.i - b.i);
  const top = sorted[0];
  return {
    status: top.status,
    reason: top.text,
    findings: sorted.map(({ status, text }) => ({ status, text })),
    next_step: top.step,
  };
}

export const SENDING_HEALTH_LABELS: Record<SendingHealthStatus, string> = {
  healthy: 'Healthy',
  watch: 'Watch',
  at_risk: 'At risk',
};

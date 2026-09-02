import { annualRecurring, dealValue, monthlyRecurring, type DealEconomics } from './pipeline.types.js';

/* ═══════════════════════════════════════════════════════════════════════
   The second life of a deal.

   A renewal is the most predictable revenue event in B2B and the one
   nobody automates. An outreach tool does not know the deal exists, so it
   stops at the reply. A CRM knows the deal, but its sequencer takes a
   static list somebody exports and re-imports, so the renewal becomes a
   diary note that gets snoozed.

   Everything here is arithmetic on facts already recorded - the term, the
   close date, the shape of the money - so nobody has to keep a spreadsheet
   of when their customers come up.
   ═══════════════════════════════════════════════════════════════════════ */

export type RenewalStatus = 'upcoming' | 'renewed' | 'churned' | 'not_applicable';

export const RENEWAL_STATUS_LABEL: Record<RenewalStatus, string> = {
  upcoming: 'Coming up',
  renewed: 'Renewed',
  churned: 'Churned',
  not_applicable: 'No renewal',
};

/** The renewal-shaped facts about a deal. */
export interface RenewalDeal extends DealEconomics {
  id?: string;
  title?: string;
  stage?: string;
  value?: number | null;
  currency?: string | null;
  closed_at?: string | null;
  renewal_date?: string | null;
  renewal_status?: RenewalStatus | null;
  renewal_notice_days?: number | null;
  renewed_to_deal_id?: string | null;
}

/* ── Dates ─────────────────────────────────────────────────────────────
   renewal_date is a calendar date, not an instant. Parsing "2027-01-15"
   with `new Date()` gives midnight UTC, which is the previous day for
   anybody west of Greenwich - so a renewal reads as one day nearer than it
   is, and "due today" arrives a day early for half the world. Parsed by
   hand into a local date instead. */

/** A YYYY-MM-DD string as a local calendar date, or null. */
export function parseCalendarDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!m) {
    const loose = new Date(value);
    return Number.isNaN(loose.getTime()) ? null : startOfDay(loose);
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole days from today to a calendar date. Negative means it has passed. */
export function daysUntil(date: string | null | undefined, today: Date = new Date()): number | null {
  const target = parseCalendarDate(date);
  if (!target) return null;
  const from = startOfDay(today);
  // Rounded, because an hour of daylight saving between the two dates would
  // otherwise push a boundary the wrong way twice a year.
  return Math.round((target.getTime() - from.getTime()) / 86400000);
}

/** A Date as YYYY-MM-DD in local time, which is how a calendar date is stored. */
export function toIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The date by which something actually has to happen.
 *
 * Plenty of contracts roll over unless cancelled a set time beforehand.
 * When they do, the renewal date is not the deadline - the notice date is,
 * and it is the one people miss, because it is the one nothing shows them.
 */
export function noticeDeadline(deal: RenewalDeal): string | null {
  const renewal = parseCalendarDate(deal.renewal_date);
  if (!renewal) return null;
  const notice = deal.renewal_notice_days;
  if (!notice || notice <= 0) return null;
  const by = new Date(renewal);
  by.setDate(by.getDate() - notice);
  return toIsoDate(by);
}

/**
 * The date this renewal is really steered by.
 *
 * The notice deadline when there is one, because that is the point of no
 * return; the renewal date otherwise.
 */
export function actionableDate(deal: RenewalDeal): string | null {
  return noticeDeadline(deal) ?? deal.renewal_date ?? null;
}

/* ── Bands ─────────────────────────────────────────────────────────────
   A flat list of renewal dates is a list. Banded, it is a plan: what has
   already slipped, what needs a conversation this week, and what is far
   enough out to prepare for properly. */

export type RenewalBandId = 'overdue' | 'this_week' | 'this_month' | 'quarter' | 'later';

export const RENEWAL_BANDS: {
  id: RenewalBandId;
  label: string;
  /** Inclusive upper bound in days. Null means everything beyond. */
  through: number | null;
  /** Said plainly, because a band with no explanation is just a colour. */
  hint: string;
}[] = [
  { id: 'overdue', label: 'Overdue', through: -1, hint: 'The date has passed and nobody has said what happened.' },
  { id: 'this_week', label: 'This week', through: 7, hint: 'Too close to start a sequence. Pick up the phone.' },
  { id: 'this_month', label: 'Within 30 days', through: 30, hint: 'The last sensible window to open the conversation.' },
  { id: 'quarter', label: 'Within 90 days', through: 90, hint: 'Where a renewal sequence should already be running.' },
  { id: 'later', label: 'Later', through: null, hint: 'Nothing to do yet. Here so the year is visible.' },
];

/** Which band a renewal falls in. Null when there is no date to band. */
export function renewalBand(deal: RenewalDeal, today: Date = new Date()): RenewalBandId | null {
  const days = daysUntil(actionableDate(deal), today);
  if (days === null) return null;
  for (const band of RENEWAL_BANDS) {
    if (band.through === null) return band.id;
    if (days <= band.through) return band.id;
  }
  return 'later';
}

/* ── Money ───────────────────────────────────────────────────────────── */

/**
 * What is actually at stake when this comes up.
 *
 * Annual recurring revenue where the deal recurs, because that is the
 * number a business is run on and the one that disappears if the customer
 * leaves. A deal with no recurring part is a repeat purchase rather than a
 * renewal, and its own value is the honest figure for it.
 */
export function renewalValue(deal: RenewalDeal): number {
  return monthlyRecurring(deal) > 0 ? annualRecurring(deal) : dealValue(deal);
}

export interface RenewalBandSummary {
  id: RenewalBandId;
  label: string;
  hint: string;
  count: number;
  value: number;
}

export interface RenewalSummary {
  bands: RenewalBandSummary[];
  /** Everything still to be decided, however far out. */
  totalCount: number;
  totalValue: number;
  /** The number worth putting at the top of a page: revenue up in 90 days. */
  atRiskCount: number;
  atRiskValue: number;
  /** Already slipped. Separated because it is a different kind of problem. */
  overdueCount: number;
  overdueValue: number;
}

/** How many are coming up, when, and for how much. */
export function renewalSummary(deals: RenewalDeal[], today: Date = new Date()): RenewalSummary {
  const bands = new Map<RenewalBandId, RenewalBandSummary>(
    RENEWAL_BANDS.map((b) => [b.id, { id: b.id, label: b.label, hint: b.hint, count: 0, value: 0 }]),
  );

  let totalCount = 0;
  let totalValue = 0;
  let atRiskCount = 0;
  let atRiskValue = 0;
  let overdueCount = 0;
  let overdueValue = 0;

  for (const deal of deals) {
    // Only renewals still to be decided. A renewed or churned deal is
    // history, and counting it as at-risk revenue would inflate the one
    // number on the page anybody acts on.
    if (deal.renewal_status !== 'upcoming') continue;
    const band = renewalBand(deal, today);
    if (!band) continue;

    const value = renewalValue(deal);
    const row = bands.get(band)!;
    row.count += 1;
    row.value += value;
    totalCount += 1;
    totalValue += value;

    if (band === 'overdue') {
      overdueCount += 1;
      overdueValue += value;
    }
    // "At risk" is the next 90 days plus whatever has already slipped - an
    // overdue renewal is not less urgent for being late.
    if (band !== 'later') {
      atRiskCount += 1;
      atRiskValue += value;
    }
  }

  return {
    bands: RENEWAL_BANDS.map((b) => bands.get(b.id)!),
    totalCount,
    totalValue,
    atRiskCount,
    atRiskValue,
    overdueCount,
    overdueValue,
  };
}

/** How a renewal reads in a sentence: "in 47 days", "today", "12 days ago". */
export function renewalPhrase(deal: RenewalDeal, today: Date = new Date()): string | null {
  const days = daysUntil(deal.renewal_date, today);
  if (days === null) return null;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days < 0) return `${Math.abs(days)} days ago`;
  return `in ${days} days`;
}

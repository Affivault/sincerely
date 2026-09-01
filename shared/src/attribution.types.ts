import type { Deal } from './crm.types.js';
import { isOpen, dealValue, weightedValue } from './pipeline.types.js';

/* ═══════════════════════════════════════════════════════════════════════
   What outreach actually earned.

   Every tool in this category optimises reply rate, because reply rate is
   the last thing it can see. A sequence with a 12% reply rate that closes
   nothing is worse than one replying at 4% that closes three deals a
   quarter, and no two-product stack can tell you which one you have — the
   replies live in one company's database and the revenue in another's.

   These are the sums for the join. Pure, so they can be checked without a
   database, and shared, so the campaign report and the deal report cannot
   drift into disagreeing about what a won deal was worth.
   ═══════════════════════════════════════════════════════════════════════ */

/** How a deal came to be credited to a campaign. See migration 059. */
export type Attribution = 'thread' | 'reply' | 'enrolment' | 'manual';

/**
 * Ranked weakest to strongest, so a report can be honest about its own
 * evidence rather than presenting a guess and a fact as one number.
 */
export const ATTRIBUTION_RANK: Record<Attribution, number> = {
  enrolment: 0,
  manual: 1,
  reply: 2,
  thread: 3,
};

export const ATTRIBUTION_LABEL: Record<Attribution, string> = {
  thread: 'From the thread',
  reply: 'Replied first',
  enrolment: 'Was in the campaign',
  manual: 'Set by hand',
};

/**
 * Evidence good enough to put in a forecast.
 *
 * `enrolment` means the person was emailed and never answered; a deal that
 * appeared afterwards may well have come from a referral. Counting it as
 * revenue the sequence produced is how an attribution number stops being
 * believed by the person reading it.
 */
export function isStrongAttribution(a: Attribution | null | undefined): boolean {
  return a === 'thread' || a === 'reply';
}

export interface AttributedDeal extends Deal {
  source_campaign_id?: string | null;
  source_step_id?: string | null;
  attribution?: Attribution | null;
}

export interface CampaignRevenue {
  campaignId: string;
  /** Deals credited to this campaign, at any strength. */
  deals: number;
  /** Of those, the ones whose evidence is strong enough to forecast on. */
  strongDeals: number;
  won: number;
  lost: number;
  open: number;
  /** Closed-won contract value. The number that pays for the campaign. */
  wonValue: number;
  /** Open pipeline, discounted by each deal's stage probability. */
  weightedOpen: number;
  /** Won value counting only strong evidence. */
  strongWonValue: number;
  /** Won of (won + lost). Null while nothing has closed either way. */
  winRate: number | null;
  /** Mean contract value of a won deal. Null with no wins. */
  averageWon: number | null;
}

function emptyRevenue(campaignId: string): CampaignRevenue {
  return {
    campaignId,
    deals: 0, strongDeals: 0, won: 0, lost: 0, open: 0,
    wonValue: 0, weightedOpen: 0, strongWonValue: 0,
    winRate: null, averageWon: null,
  };
}

/**
 * Roll deals up by the campaign that produced them.
 *
 * Unattributed deals are left out rather than bucketed under "unknown".
 * A campaign report is a claim about what specific outreach did, and
 * padding it with deals nothing is known about makes every row less true.
 */
export function revenueByCampaign(deals: AttributedDeal[]): CampaignRevenue[] {
  const byId = new Map<string, CampaignRevenue>();

  for (const deal of deals) {
    const id = deal.source_campaign_id;
    if (!id || !deal.attribution) continue;

    const row = byId.get(id) ?? emptyRevenue(id);
    const strong = isStrongAttribution(deal.attribution);
    // dealValue, not totalContractValue: a deal that only ever had a single
    // figure has no economics to compute from, so TCV reads zero for it. Using
    // that here would make every unshaped deal worth nothing in this report
    // while the board showed its real value - two totals for one deal.
    const value = dealValue(deal);

    row.deals += 1;
    if (strong) row.strongDeals += 1;

    if (deal.stage === 'won') {
      row.won += 1;
      row.wonValue += value;
      if (strong) row.strongWonValue += value;
    } else if (deal.stage === 'lost') {
      row.lost += 1;
    } else if (isOpen(deal.stage)) {
      row.open += 1;
      row.weightedOpen += weightedValue(deal);
    }

    byId.set(id, row);
  }

  for (const row of byId.values()) {
    const closed = row.won + row.lost;
    row.winRate = closed > 0 ? row.won / closed : null;
    row.averageWon = row.won > 0 ? row.wonValue / row.won : null;
  }

  // Biggest earner first: the ordering every reader of this wants.
  return [...byId.values()].sort((a, b) => b.wonValue - a.wonValue);
}

/**
 * A step in the outreach funnel.
 *
 * Distinct from pipeline.types' FunnelStage, which counts deals by pipeline
 * stage. This one spans sent-to-won, so the two must not share a name — one
 * is "where are my deals", the other is "did the outreach work".
 */
export interface OutreachFunnelStep {
  label: string;
  count: number;
  /** Share of the step before it. Null for the first, and where the previous is zero. */
  ofPrevious: number | null;
}

/**
 * Sent to won, as the stages a person actually thinks in.
 *
 * The conversion is expressed against the previous step rather than against
 * the top, because "3 of 14 replies closed" is the number that changes what
 * somebody does next, and "3 of 2,000 sent" is the number that makes them
 * feel bad without telling them where the loss was.
 */
export function outreachFunnel(counts: {
  sent: number; replied: number; deals: number; won: number;
}): OutreachFunnelStep[] {
  const steps: [string, number][] = [
    ['Sent', counts.sent],
    ['Replied', counts.replied],
    ['Became a deal', counts.deals],
    ['Won', counts.won],
  ];
  return steps.map(([label, count], i) => {
    const prev = i === 0 ? null : steps[i - 1][1];
    return {
      label,
      count,
      ofPrevious: prev === null || prev === 0 ? null : count / prev,
    };
  });
}

/**
 * What one reply was worth.
 *
 * The number that decides whether a sequence is worth running again, and the
 * one a two-tool stack structurally cannot produce. Null rather than zero
 * when nothing has replied: no evidence is not the same as no value, and
 * showing a confident 0 would be a lie about an experiment still running.
 */
export function valuePerReply(wonValue: number, replies: number): number | null {
  return replies > 0 ? wonValue / replies : null;
}

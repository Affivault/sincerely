/**
 * Finding an address that isn't published anywhere.
 *
 * Harvesting only ever returns what a page prints. Most people at a company
 * never appear in a mailto: link, so the useful question is the other one:
 * given a name and a domain, which address actually exists? That is answered by
 * building the addresses the domain's own convention implies and asking the
 * domain's mail server which of them it will accept.
 */

/** One of the naming conventions companies use for mailboxes. */
export type EmailPatternId =
  | 'first.last'
  | 'firstlast'
  | 'first_last'
  | 'first-last'
  | 'flast'
  | 'f.last'
  | 'firstl'
  | 'first'
  | 'last'
  | 'last.first'
  | 'lastfirst'
  | 'lastf'
  | 'fl';

export interface EmailCandidate {
  email: string;
  pattern: EmailPatternId;
  /** Position in the ranked list, 1-based. Rank 1 is the best guess. */
  rank: number;
  /**
   * How the mail server answered, when it was asked. 'accepted' is proof the
   * mailbox exists; 'rejected' is proof it does not; null means unasked.
   */
  smtp: 'accepted' | 'rejected' | 'inconclusive' | null;
}

export interface FindEmailInput {
  domain: string;
  first_name?: string;
  last_name?: string;
  /** Used when the name hasn't been split; ignored if first/last are given. */
  full_name?: string;
}

export interface FindEmailResult {
  /** True only when an address was produced. Check `verified` for proof. */
  found: boolean;
  email: string | null;
  pattern: EmailPatternId | null;
  /**
   * 0–100. 90+ means a mail server accepted the address. Anything under 60 is
   * a convention-based guess that could not be confirmed, and should be
   * presented as such rather than as a finding.
   */
  confidence: number;
  /** A mail server accepted this exact address. */
  verified: boolean;
  /**
   * The domain accepts every address, so acceptance proves nothing and the
   * result is only as good as the pattern guess.
   */
  catch_all: boolean;
  /** The domain has MX (or at least A) records, so it can receive mail at all. */
  mx: boolean;
  /**
   * False when no mail server could be reached — commonly outbound port 25
   * blocked by the host. Results are unverified guesses when this is false, and
   * saying so is the point of the field.
   */
  smtp_checked: boolean;
  /**
   * The pattern was confirmed from addresses already in the account for this
   * domain, rather than assumed from what is common.
   */
  pattern_from_known: boolean;
  /** Ranked alternatives, so a wrong first guess isn't a dead end. */
  candidates: EmailCandidate[];
  reason: string;
}

// Phrases that commonly trip spam filters in cold-outreach email. Not exhaustive —
// just the well-known offenders worth flagging before a campaign goes out.
export const SPAM_TRIGGER_PHRASES = [
  '100% free', 'act now', 'act immediately', 'apply now', 'best price', 'buy now',
  'call now', 'cancel at any time', 'cash bonus', 'click here', 'congratulations',
  'credit card', 'double your', 'earn money', 'earn extra cash', 'free gift',
  'free trial', 'guarantee', 'guaranteed', 'increase sales', 'incredible deal',
  'limited time', 'lower your', 'make money', 'million dollars', 'no cost',
  'no fees', 'no fee', 'no obligation', 'once in a lifetime', 'order now',
  'prize', 'risk free', 'risk-free', 'satisfaction guaranteed',
  'special promotion', 'subscribe now', 'urgent', 'while supplies last',
  'winner', 'winning', 'work from home',
];

export interface SpamCheckResult {
  matches: string[];
  hasExcessiveCaps: boolean;
  hasExcessivePunctuation: boolean;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function checkSpamSignals(subject: string, bodyHtml: string): SpamCheckResult {
  const combined = `${subject} ${stripHtml(bodyHtml)}`.toLowerCase();
  const matches = SPAM_TRIGGER_PHRASES.filter(phrase => combined.includes(phrase));

  const letters = subject.replace(/[^A-Za-z]/g, '');
  const upper = subject.replace(/[^A-Z]/g, '');
  const hasExcessiveCaps = letters.length >= 6 && upper.length / letters.length > 0.6;

  const hasExcessivePunctuation = /[!?]{2,}/.test(subject) || (subject.match(/!/g) || []).length > 1;

  return { matches, hasExcessiveCaps, hasExcessivePunctuation };
}

export function hasSpamSignals(result: SpamCheckResult): boolean {
  return result.matches.length > 0 || result.hasExcessiveCaps || result.hasExcessivePunctuation;
}

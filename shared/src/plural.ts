/**
 * "1 deal", "3 deals" - a count and its noun, agreeing.
 *
 * The app had "campaign(s)", "deal(s)", "inbox(es)" and "1 deals" in front
 * of people. The irregular plural is passed when the noun needs one.
 */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

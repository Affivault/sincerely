import type { AutopilotStatus } from '@lemlist/shared';

/** What the autopilot is doing, as short phrases. Empty when it is doing nothing worth saying. */
export function autopilotBits(data: AutopilotStatus | undefined | null): string[] {
  if (!data?.ready || !data.enabled) return [];
  const held = data.mailboxes.filter((m) => m.state !== 'active');
  const w = data.week;
  const bits: string[] = [];
  if (held.some((m) => m.state === 'resting')) {
    const n = held.filter((m) => m.state === 'resting').length;
    bits.push(`resting ${n} mailbox${n === 1 ? '' : 'es'} now`);
  } else if (held.length) {
    bits.push(`holding ${held.length} mailbox${held.length === 1 ? '' : 'es'} back while ${held.length === 1 ? 'it settles' : 'they settle'}`);
  }
  if (data.holds.length) bits.push(`${data.holds.length} provider${data.holds.length === 1 ? '' : 's'} paused`);
  if (w.bounces_found) bits.push(`${w.bounces_found} bounce${w.bounces_found === 1 ? '' : 's'} caught this week`);
  if (!held.length && w.rests) bits.push(`${w.rests} rest${w.rests === 1 ? '' : 's'} this week, all recovered`);
  return bits;
}

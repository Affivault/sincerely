import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ShieldCheck, ArrowRight } from 'lucide-react';
import { autopilotApi } from '../../api/autopilot.api';

/**
 * One line on Home when the autopilot has done something this week, or is
 * holding a mailbox back now. Silent otherwise: a card that says "all
 * fine" every day is a card nobody reads on the day it doesn't.
 */
export function AutopilotNote() {
  const { data } = useQuery({
    queryKey: ['autopilot'],
    queryFn: autopilotApi.status,
    staleTime: 60_000,
    meta: { silentError: true },
  });
  if (!data?.ready || !data.enabled) return null;

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
  if (bits.length === 0) return null;

  return (
    <Link
      to="/email-accounts?tab=autopilot"
      className="group flex items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2.5 transition-colors hover:bg-[var(--bg-hover)]"
      data-autopilot-note
    >
      <ShieldCheck className="h-4 w-4 flex-shrink-0 text-emerald-500" />
      <span className="min-w-0 flex-1 truncate text-body text-[var(--text-secondary)]">
        <span className="font-semibold text-[var(--text-primary)]">Autopilot</span>{' '}
        {bits.join(' · ')}. Your campaigns keep sending.
      </span>
      <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-[var(--text-tertiary)] transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

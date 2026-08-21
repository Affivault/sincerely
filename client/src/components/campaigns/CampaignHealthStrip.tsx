import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { campaignsApi } from '../../api/campaigns.api';
import type { CampaignIssue } from '@lemlist/shared';
import { cn } from '../../lib/utils';
import { Activity, AlertTriangle, ArrowRight, CheckCircle2, OctagonAlert } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════════
   Whether a running campaign is actually running.

   The status badge says "running" from launch until somebody changes it,
   and every way of not sending is silent underneath it: an expired mailbox
   password, a tripped bounce guard, a sending window nobody is awake for,
   a queue where every contact sits on an error. Sends go to zero and the
   first signal is a fortnight without replies.

   The facts were all there. The bounce guard knew, the sender pool knew,
   the schedule knew. Nothing asked them on behalf of the person who cared.
   ═══════════════════════════════════════════════════════════════════════ */

const LEVEL = {
  ok: {
    Icon: CheckCircle2,
    ring: 'border-emerald-500/25',
    bg: 'bg-emerald-500/[0.06]',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  attention: {
    Icon: AlertTriangle,
    ring: 'border-amber-500/30',
    bg: 'bg-amber-500/[0.07]',
    text: 'text-amber-600 dark:text-amber-400',
  },
  stalled: {
    Icon: OctagonAlert,
    ring: 'border-red-500/30',
    bg: 'bg-red-500/[0.07]',
    text: 'text-red-600 dark:text-red-400',
  },
} as const;

function IssueRow({ issue }: { issue: CampaignIssue }) {
  return (
    <li className="flex items-start gap-2.5 border-t border-[var(--border-subtle)] px-4 py-2.5">
      <span
        className={cn(
          'mt-[5px] h-1.5 w-1.5 flex-shrink-0 rounded-full',
          issue.level === 'stalled' ? 'bg-red-500' : 'bg-amber-500',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium leading-snug text-[var(--text-primary)]">{issue.headline}</p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--text-tertiary)]">{issue.detail}</p>
      </div>
      {issue.fix && (
        <Link
          to={issue.fix.href}
          className="mt-px inline-flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-semibold text-[var(--indigo)] transition-colors hover:bg-[var(--indigo-subtle)]"
        >
          {issue.fix.label}
          <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </li>
  );
}

export function CampaignHealthStrip({ campaignId, status }: { campaignId: string; status?: string }) {
  const live = ['running', 'scheduled', 'paused'].includes(String(status));

  const { data, isError } = useQuery({
    queryKey: ['campaign-health', campaignId],
    queryFn: () => campaignsApi.health(campaignId),
    // Only asked for campaigns that are supposed to be sending. A draft has
    // no health to report, and saying "not sending" about a draft would be
    // both true and useless.
    enabled: !!campaignId && live,
    refetchInterval: 60_000,
    meta: { silentError: true },
  });

  // A failed health check is not a verdict on the campaign, so it says
  // nothing rather than inventing an alarm.
  if (!live || isError || !data) return null;

  const style = LEVEL[data.level];

  return (
    <div className={cn('overflow-hidden rounded-xl border', style.ring, style.bg)}>
      <div className="flex items-start gap-2.5 px-4 py-3">
        <style.Icon className={cn('mt-px h-4 w-4 flex-shrink-0', style.text)} />
        <div className="min-w-0 flex-1">
          <p className={cn('text-[12.5px] font-semibold leading-snug', style.text)}>{data.summary}</p>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
            <span className="inline-flex items-center gap-1">
              <Activity className="h-3 w-3" />
              <span className="font-semibold tabular-nums text-[var(--text-secondary)]">
                {data.sent_24h.toLocaleString()}
              </span>
              sent in 24h
            </span>
            {data.pending > 0 && (
              <span>
                <span className="font-semibold tabular-nums text-[var(--text-secondary)]">
                  {data.pending.toLocaleString()}
                </span>{' '}
                waiting
              </span>
            )}
            {data.errored > 0 && (
              <span className="text-amber-600 dark:text-amber-400">
                <span className="font-semibold tabular-nums">{data.errored.toLocaleString()}</span> errored
              </span>
            )}
            {data.capacity_today !== null && (
              <span>
                <span className="font-semibold tabular-nums text-[var(--text-secondary)]">
                  {data.capacity_today.toLocaleString()}
                </span>{' '}
                sends left today
              </span>
            )}
          </div>
        </div>
      </div>

      {data.issues.length > 0 && (
        <ul className="bg-[var(--bg-surface)]/60">
          {data.issues.map((issue) => (
            <IssueRow key={issue.id} issue={issue} />
          ))}
        </ul>
      )}
    </div>
  );
}

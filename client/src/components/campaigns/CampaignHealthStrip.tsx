import { TONE, type Tone } from '../ui/tone';
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
  ok: { Icon: CheckCircle2, tone: 'positive' },
  attention: { Icon: AlertTriangle, tone: 'attention' },
  stalled: { Icon: OctagonAlert, tone: 'negative' },
} as const satisfies Record<string, { Icon: unknown; tone: Tone }>;

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
        <p className="text-body font-medium leading-snug text-[var(--text-primary)]">{issue.headline}</p>
        <p className="mt-0.5 text-caption leading-relaxed text-[var(--text-tertiary)]">{issue.detail}</p>
      </div>
      {issue.fix && (
        <Link
          to={issue.fix.href}
          className="mt-px inline-flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-1 text-caption font-semibold text-[var(--indigo-text)] transition-colors hover:bg-[var(--indigo-subtle)]"
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
    // Drawn as a notice (see ui/Notice): white, the state in the rule and the icon.
    <div className="relative overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]">
      <span aria-hidden className={cn('absolute left-0 inset-y-0 w-[3px]', TONE[style.tone].solid)} />
      <div className="flex items-start gap-2.5 pl-4 pr-4 py-3">
        <style.Icon className={cn('mt-[3px] h-3.5 w-3.5 flex-shrink-0', TONE[style.tone].icon)} strokeWidth={2} />
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold leading-snug text-[var(--text-primary)]">{data.summary}</p>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-[var(--text-tertiary)]">
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
              <span className={TONE.attention.text}>
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
        <ul>
          {data.issues.map((issue) => (
            <IssueRow key={issue.id} issue={issue} />
          ))}
        </ul>
      )}
    </div>
  );
}

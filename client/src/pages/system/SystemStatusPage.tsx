import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  HeartPulse, CheckCircle2, AlertTriangle, XCircle, ArrowRight, Loader2, PlayCircle,
  ChevronDown, Circle,
} from 'lucide-react';
import type { JobHealth, SelfTestResult, StatusIssue, StatusJob } from '@lemlist/shared';
import { PageHeader } from '../../components/shared/PageHeader';
import { Button } from '../../components/ui/Button';
import { PageSkeleton } from '../../components/ui/Skeleton';
import { systemApi } from '../../api/system.api';
import { cn, formatRelativeTime } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   Is everything running?

   One answer at the top, then the evidence: what needs a look, every
   background job and when it last ran, and a check you can run yourself
   that signs every mailbox in and sends it a test. The same problems go to
   Slack or your webhooks on their own - this is where you come to see them.
   ═══════════════════════════════════════════════════════════════════════ */

const HEALTH: Record<JobHealth, { label: string; dot: string; text: string }> = {
  ok: { label: 'Running', dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400' },
  late: { label: 'Behind', dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400' },
  failing: { label: 'Failing', dot: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-400' },
  stalled: { label: 'Stopped', dot: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-400' },
  never: { label: 'Starting', dot: 'bg-[var(--text-muted)]', text: 'text-[var(--text-tertiary)]' },
};

function every(ms: number): string {
  if (ms < 60_000) return `every ${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `every ${Math.round(ms / 60_000)} min`;
  return `every ${Math.round(ms / 3_600_000)}h`;
}

export function SystemStatusPage() {
  const [showAll, setShowAll] = useState(false);
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['system-status'],
    queryFn: systemApi.status,
    refetchInterval: 30_000,
    meta: { silentError: true },
  });
  const test = useMutation({ mutationFn: systemApi.selfTest });

  const level = data?.level || 'ok';
  const banner = level === 'ok'
    ? { icon: CheckCircle2, cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20' }
    : level === 'attention'
      ? { icon: AlertTriangle, cls: 'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/25' }
      : { icon: XCircle, cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/25' };
  const Banner = banner.icon;
  const core = (data?.jobs || []).filter((j) => j.core);
  const others = (data?.jobs || []).filter((j) => !j.core);
  // Anything not healthy is shown whatever the toggle says.
  const visibleOthers = showAll ? others : others.filter((j) => j.health !== 'ok' && j.health !== 'never');

  return (
    <>
      <PageHeader
        icon={HeartPulse}
        title="System status"
        description="Everything that runs in the background - sending, inbox sync, the autopilot - and whether it is running right now."
        actions={
          <Button variant="secondary" onClick={() => test.mutate()} disabled={test.isPending}>
            {test.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            {test.isPending ? 'Checking…' : 'Run checks'}
          </Button>
        }
      />
      <div className="space-y-4" data-system-status>
        {isLoading ? (
          <PageSkeleton variant="panels" bleed={false} />
        ) : isError || !data ? (
          <div className="flex items-center gap-3 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3.5 text-body text-rose-700 dark:text-rose-400">
            <XCircle className="h-5 w-5 flex-shrink-0" />
            <span className="flex-1">The server did not answer. If this keeps happening, it may be down or restarting.</span>
            <Button size="sm" variant="secondary" onClick={() => refetch()}>Try again</Button>
          </div>
        ) : (
          <div className={cn('flex items-start gap-3 rounded-2xl border px-4 py-3.5', banner.cls)} data-status-level={level}>
            <Banner className="mt-0.5 h-5 w-5 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-heading font-semibold">{data.headline}</p>
              <p className="mt-0.5 text-caption opacity-80">
                Checked {formatRelativeTime(data.checked_at)}{isFetching ? ' · refreshing' : ''} · problems are also sent to Slack and your webhooks
                {!data.persisted && ' · run migration 078 to keep this history across restarts'}
              </p>
            </div>
          </div>
        )}

        {test.data && <SelfTest results={test.data.results} />}
        {test.isError && (
          <p className="text-body text-rose-600">The checks could not be run: {(test.error as any)?.response?.data?.error || 'the server did not answer'}.</p>
        )}

        {data && data.issues.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <div className="border-b border-[var(--border-subtle)] px-4 py-3">
              <p className="text-strong font-semibold text-[var(--text-primary)]">Needs a look</p>
            </div>
            <ul className="divide-y divide-[var(--border-subtle)]">
              {data.issues.map((i) => <IssueRow key={i.key} issue={i} />)}
            </ul>
          </div>
        )}

        {data && (
          <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <div className="border-b border-[var(--border-subtle)] px-4 py-3">
              <p className="text-strong font-semibold text-[var(--text-primary)]">Background jobs</p>
              <p className="text-caption text-[var(--text-tertiary)]">Behind means three missed runs; stopped means six.</p>
            </div>
            <ul className="divide-y divide-[var(--border-subtle)]">
              {core.map((j) => <JobRow key={j.id} job={j} />)}
              {visibleOthers.map((j) => <JobRow key={j.id} job={j} />)}
            </ul>
            {others.length > 0 && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                aria-expanded={showAll}
                className="flex w-full items-center gap-2 border-t border-[var(--border-subtle)] px-4 h-10 text-left text-body text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                {showAll ? 'Show fewer' : `Show all ${data.jobs.length} jobs`}
                <ChevronDown className={cn('ml-auto h-4 w-4 transition-transform', showAll && 'rotate-180')} />
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function IssueRow({ issue }: { issue: StatusIssue }) {
  const down = issue.level === 'down';
  return (
    <li className="flex items-start gap-3 px-4 py-3" data-status-issue={issue.level}>
      {down ? <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-500" /> : <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />}
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium text-[var(--text-primary)]">{issue.title}</p>
        <p className="mt-0.5 text-caption leading-relaxed text-[var(--text-tertiary)]">{issue.detail}</p>
        {issue.since && <p className="mt-0.5 text-micro text-[var(--text-muted)]">Since {formatRelativeTime(issue.since)}</p>}
      </div>
      {issue.href && (
        <Link to={issue.href} className="inline-flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-1 text-caption font-semibold text-[var(--indigo)] hover:bg-[var(--indigo-subtle)]">
          Open <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </li>
  );
}

function JobRow({ job }: { job: StatusJob }) {
  const h = HEALTH[job.health];
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5" data-job={job.id} data-job-health={job.health}>
      <span className={cn('h-2 w-2 flex-shrink-0 rounded-full', h.dot)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium text-[var(--text-primary)]">{job.label}</p>
        <p className="truncate text-caption text-[var(--text-tertiary)]">{job.what}</p>
        {job.last_error && job.health !== 'ok' && (
          <p className="line-clamp-3 break-words text-caption text-rose-600 dark:text-rose-400" title={job.last_error}>{job.last_error}</p>
        )}
      </div>
      <div className="text-right">
        <p className={cn('text-caption font-semibold', h.text)}>{h.label}</p>
        <p className="text-micro text-[var(--text-muted)]">
          {job.last_ok_at ? `ran ${formatRelativeTime(job.last_ok_at)}` : 'not yet'} · {every(job.every_ms)}
        </p>
      </div>
    </li>
  );
}

function SelfTest({ results }: { results: SelfTestResult[] }) {
  const failed = results.filter((r) => !r.ok).length;
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]" data-self-test>
      <div className="border-b border-[var(--border-subtle)] px-4 py-3">
        <p className="text-strong font-semibold text-[var(--text-primary)]">
          {failed === 0 ? 'Every check passed' : `${failed} of ${results.length} checks failed`}
        </p>
        <p className="text-caption text-[var(--text-tertiary)]">Each mailbox signed in, sent a test to itself and read its inbox.</p>
      </div>
      <ul className="divide-y divide-[var(--border-subtle)]">
        {results.map((r) => (
          <li key={r.id} className="flex items-start gap-3 px-4 py-2.5">
            {r.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" /> : r.id.startsWith('job:') ? <Circle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" /> : <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-500" />}
            <div className="min-w-0 flex-1">
              <p className="text-body font-medium text-[var(--text-primary)]">{r.label}</p>
              <p className="text-caption text-[var(--text-tertiary)]">{r.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

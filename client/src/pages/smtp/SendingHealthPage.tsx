import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity, AlertTriangle, ArrowRight, CheckCircle2, Flame, Gauge, Mail, RefreshCw, ShieldAlert, ShieldCheck, Target,
} from 'lucide-react';
import {
  AUTOPILOT_STATE_LABELS, SENDING_HEALTH_LABELS, DAILY_LIMIT_PRESETS, GAP_PRESETS, PROVIDER_LABELS, formatGap, formatDailyLimit, formatTime, plural,
  type MailboxHealth, type SendingHealthReport, type SendingHealthStatus, type SendingHealthDay,
} from '@lemlist/shared';
import { smtpApi } from '../../api/smtp.api';
import { PageHeader } from '../../components/shared/PageHeader';
import { StatCard } from '../../components/shared/StatCard';
import { AsyncPanel } from '../../components/ui/AsyncPanel';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { Checkbox } from '../../components/ui/Checkbox';
import { BulkPace } from '../../components/mailbox/BulkPace';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   Sending health.

   Every mailbox, one row each, answering the question the five delivery
   tabs answered piecemeal: is this mailbox all right, and if not, what do
   I do about it? Today's sends against what it may send, its pace, its
   warm-up, whether the autopilot is holding it back, two weeks of bounces
   and spam reports, its domain's SPF/DKIM/DMARC, and the last placement
   test - then one verdict in words, and the one step most likely to help.

   The verdict is the server's (shared/sending-health), so this page and
   anything else that asks cannot disagree. Worst mailboxes come first.

   This replaced the old "Sender health" page at /sse, which showed a
   health score and a utilisation bar and left the reading to you.
   ═══════════════════════════════════════════════════════════════════════ */

const STATUS_STYLE: Record<SendingHealthStatus, { chip: string; bar: string; icon: typeof CheckCircle2 }> = {
  healthy: { chip: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400', bar: 'bg-emerald-500', icon: CheckCircle2 },
  watch: { chip: 'bg-amber-500/10 text-amber-700 dark:text-amber-400', bar: 'bg-amber-500', icon: AlertTriangle },
  at_risk: { chip: 'bg-rose-500/10 text-rose-700 dark:text-rose-400', bar: 'bg-rose-500', icon: ShieldAlert },
};

type Filter = 'all' | SendingHealthStatus;

/** Fourteen small columns: sends as height, refusals drawn over them. */
function TrendBars({ days }: { days: SendingHealthDay[] }) {
  const max = Math.max(1, ...days.map((d) => d.sent));
  const sent = days.reduce((n, d) => n + d.sent, 0);
  const refused = days.reduce((n, d) => n + d.bounced, 0);
  const reported = days.reduce((n, d) => n + d.complained, 0);
  return (
    <div
      className="flex h-8 items-end gap-px"
      role="img"
      aria-label={`Last 14 days: ${sent} sent, ${refused} bounced, ${reported} marked as spam`}
    >
      {days.map((d) => (
        <span
          key={d.date}
          title={`${d.date}: ${d.sent} sent, ${d.bounced} bounced${d.complained ? `, ${d.complained} spam` : ''}`}
          className="relative flex-1 rounded-sm bg-[var(--bg-elevated)]"
          style={{ height: '100%' }}
        >
          <span className="absolute inset-x-0 bottom-0 rounded-sm bg-[var(--indigo)] opacity-60" style={{ height: `${(d.sent / max) * 100}%` }} />
          {(d.bounced > 0 || d.complained > 0) && (
            <span
              className={cn('absolute inset-x-0 bottom-0 rounded-sm', d.complained > 0 ? 'bg-rose-600' : 'bg-amber-500')}
              style={{ height: `${Math.max(12, ((d.bounced + d.complained) / max) * 100)}%` }}
            />
          )}
        </span>
      ))}
    </div>
  );
}

function AuthBadge({ ok, checked, label }: { ok: boolean; checked: boolean; label: string }) {
  return (
    <span className={cn(
      'inline-flex h-[18px] items-center rounded px-1.5 text-micro font-semibold',
      !checked ? 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]'
        : ok ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
        : 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
    )}>
      {label}{checked ? (ok ? ' ✓' : ' ✕') : ' ?'}
    </span>
  );
}

function Meter({ value, max, tone }: { value: number; max: number; tone: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-elevated)]">
      <div className={cn('h-full rounded-full transition-all', tone)} style={{ width: `${pct}%` }} />
    </div>
  );
}

function MailboxRow({ m, selected, onSelect, onStep }: {
  m: MailboxHealth;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onStep: (m: MailboxHealth) => void;
}) {
  const style = STATUS_STYLE[m.health.status];
  const StatusIcon = style.icon;
  const cap = m.allowance_today;
  const resting = m.autopilot.state === 'resting';
  const others = m.health.findings.slice(1);

  return (
    <li className="relative px-4 py-3.5">
      <span className={cn('absolute bottom-3 left-0 top-3 w-[3px] rounded-r-full', style.bar)} aria-hidden />
      <div className="flex flex-wrap items-start gap-3">
        <Checkbox checked={selected} onChange={onSelect} aria-label={`Select ${m.email_address}`} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-strong font-semibold text-[var(--text-primary)]">{m.email_address}</h2>
            <span className={cn('inline-flex h-[18px] items-center gap-1 rounded px-1.5 text-micro font-semibold', style.chip)}>
              <StatusIcon className="h-3 w-3" /> {SENDING_HEALTH_LABELS[m.health.status]}
            </span>
            {m.autopilot.state !== 'active' && (
              <span className="inline-flex h-[18px] items-center rounded bg-[var(--bg-elevated)] px-1.5 text-micro font-semibold text-[var(--text-secondary)]">
                {AUTOPILOT_STATE_LABELS[m.autopilot.state]}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-body text-[var(--text-secondary)]">{m.health.reason}</p>
          {others.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {others.map((f) => (
                <li key={f.text} className="flex items-start gap-1.5 text-caption text-[var(--text-tertiary)]">
                  <span className={cn('mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full', STATUS_STYLE[f.status].bar)} aria-hidden />
                  {f.text}
                </li>
              ))}
            </ul>
          )}
        </div>
        {m.health.next_step.kind !== 'none' && (
          <Button size="sm" variant={m.health.status === 'healthy' ? 'secondary' : 'primary'} onClick={() => onStep(m)}>
            {m.health.next_step.label} <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 pl-8 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-micro font-medium text-[var(--text-tertiary)]">Sent today</p>
          <p className="text-body tabular text-[var(--text-primary)]">
            {resting ? 'Resting' : `${m.sends_today} of ${cap === 0 ? 'no limit' : cap}`}
            {cap !== m.daily_send_limit && m.daily_send_limit > 0 && !resting && (
              <span className="text-caption text-[var(--text-tertiary)]"> · limit {formatDailyLimit(m.daily_send_limit)}</span>
            )}
          </p>
          <Meter value={m.sends_today} max={cap || Math.max(m.sends_today, 1)} tone="bg-[var(--indigo)]" />
          <p className="mt-1 text-caption text-[var(--text-tertiary)]">{formatGap(m.gap_min, m.gap_max)} between emails</p>
        </div>

        <div>
          <p className="text-micro font-medium text-[var(--text-tertiary)]">Warm-up</p>
          {m.warmup.on ? (
            <>
              <p className="flex items-center gap-1 text-body text-[var(--text-primary)]">
                <Flame className="h-3 w-3 text-amber-500" />
                {m.warmup.complete ? 'Ramp complete' : `Day ${m.warmup.day + 1} of ${m.warmup.ramp_days}`}
              </p>
              <Meter value={Math.min(m.warmup.day, m.warmup.ramp_days)} max={m.warmup.ramp_days} tone="bg-amber-500" />
              <p className="mt-1 text-caption text-[var(--text-tertiary)]">{m.warmup.allowance === 0 ? 'No cap' : `${m.warmup.allowance} a day`} allowed now</p>
            </>
          ) : (
            <p className="text-body text-[var(--text-tertiary)]">Off</p>
          )}
        </div>

        <div>
          <p className="text-micro font-medium text-[var(--text-tertiary)]">Bounces and spam, 14 days</p>
          <TrendBars days={m.trend} />
          <p className="mt-1 text-caption tabular text-[var(--text-tertiary)]">
            {m.totals_14d.sent.toLocaleString()} sent · {m.totals_14d.bounce_rate}% bounced · {m.totals_14d.complained} spam
          </p>
        </div>

        <div>
          <p className="text-micro font-medium text-[var(--text-tertiary)]">{m.domain.domain || 'Domain'}</p>
          <div className="mt-0.5 flex flex-wrap gap-1">
            <AuthBadge ok={m.domain.spf} checked={m.domain.checked} label="SPF" />
            <AuthBadge ok={m.domain.dkim} checked={m.domain.checked} label="DKIM" />
            <AuthBadge ok={m.domain.dmarc} checked={m.domain.checked} label="DMARC" />
          </div>
          <p className="mt-1 text-caption text-[var(--text-tertiary)]">
            {m.placement
              ? `Placement: ${m.placement.inbox_rate === null ? m.placement.headline : `${Math.round(m.placement.inbox_rate * 100)}% to the inbox`}`
              : 'No placement test yet'}
          </p>
        </div>
      </div>
    </li>
  );
}

export function SendingHealthPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pace, setPace] = useState<{ ids?: string[]; careful?: boolean } | null>(null);

  const query = useQuery({
    queryKey: ['sending-health'],
    queryFn: smtpApi.health,
    // DNS and placement change slowly; sends today move, but a minute is plenty.
    staleTime: 60_000,
  });
  const report = query.data;

  const visible = useMemo(
    () => (report?.mailboxes || []).filter((m) => filter === 'all' || m.health.status === filter),
    [report, filter],
  );

  const runStep = (m: MailboxHealth) => {
    switch (m.health.next_step.kind) {
      case 'reconnect': navigate(`/email-accounts?mailbox=${m.id}`); break;
      case 'authenticate_domain':
        navigate(m.domain.domain_id ? `/email-accounts?domain=${m.domain.domain_id}` : `/email-accounts?add=${encodeURIComponent(m.domain.domain)}`);
        break;
      case 'view_autopilot': navigate('/email-accounts?tab=autopilot'); break;
      case 'start_warmup': navigate('/email-accounts?tab=warmup'); break;
      case 'run_placement': navigate('/placement'); break;
      case 'slow_pace': setPace({ ids: [m.id], careful: true }); break;
      default: break;
    }
  };

  const paceTargets = (report?.mailboxes || []).map((m) => ({
    id: m.id, label: m.label, email_address: m.email_address,
    daily_send_limit: m.daily_send_limit, gap_min: m.gap_min, gap_max: m.gap_max,
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Activity}
        title="Sending health"
        description="Every mailbox: what it sent today, how it is paced and warmed, its bounces, its domain and where its mail lands."
        meta={report ? (
          <span className="tabular">
            {plural(report.mailboxes.length, 'mailbox', 'mailboxes')} · checked {formatTime(report.generated_at)}
          </span>
        ) : undefined}
        actions={
          <>
            <Link to="/email-accounts" className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-body text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
              <Mail className="h-3.5 w-3.5" /> Email accounts
            </Link>
            <button onClick={() => query.refetch()} className="icon-btn" title="Check again" aria-label="Check again">
              <RefreshCw className={cn('h-3.5 w-3.5', query.isFetching && 'animate-spin')} />
            </button>
            <Button size="sm" onClick={() => setPace({ ids: selected.size ? [...selected] : undefined })} disabled={!report || report.mailboxes.length === 0}>
              <Gauge className="h-3.5 w-3.5" /> {selected.size ? `Set pace for ${selected.size} selected` : 'Set pace for all'}
            </Button>
          </>
        }
      />

      <AsyncPanel
        query={query}
        skeleton="list"
        skeletonRows={4}
        isEmpty={(r: SendingHealthReport) => r.mailboxes.length === 0}
        empty={{
          icon: Mail,
          title: 'No mailboxes to check yet',
          description: 'Connect the mailbox you send from and its health shows here: pace, warm-up, bounces, DNS and placement.',
          actionLabel: 'Connect mailbox',
          onAction: () => navigate('/email-accounts?connect=1'),
        }}
      >
        {(r) => (
          <div className="space-y-4">
            <div className="fact-strip grid-cols-3">
              <StatCard inStrip label="At risk" value={r.counts.at_risk} icon={ShieldAlert} accent={r.counts.at_risk ? 'rose' : 'slate'} onClick={() => setFilter('at_risk')} />
              <StatCard inStrip label="Watch" value={r.counts.watch} icon={AlertTriangle} accent={r.counts.watch ? 'amber' : 'slate'} onClick={() => setFilter('watch')} />
              <StatCard inStrip label="Healthy" value={r.counts.healthy} icon={ShieldCheck} accent="emerald" onClick={() => setFilter('healthy')} />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(['all', 'at_risk', 'watch', 'healthy'] as const).map((f) => (
                <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
                  {f === 'all' ? `All ${r.mailboxes.length}` : `${SENDING_HEALTH_LABELS[f]} ${r.counts[f]}`}
                </Chip>
              ))}
              {selected.size > 0 && (
                <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-caption font-medium text-[var(--indigo-text)] hover:underline">
                  Clear selection
                </button>
              )}
            </div>

            {visible.length === 0 ? (
              <p className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-8 text-center text-body text-[var(--text-tertiary)]">
                No mailbox is in this group right now.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                {visible.map((m) => (
                  <MailboxRow
                    key={m.id}
                    m={m}
                    selected={selected.has(m.id)}
                    onSelect={(on) => setSelected((prev) => {
                      const next = new Set(prev);
                      if (on) next.add(m.id); else next.delete(m.id);
                      return next;
                    })}
                    onStep={runStep}
                  />
                ))}
              </ul>
            )}

            {!r.placement_available && (
              <p className="flex items-center gap-1.5 text-caption text-[var(--text-tertiary)]">
                <Target className="h-3 w-3" /> Placement results need migration 070; until then this page cannot say where mail lands.
              </p>
            )}
            <p className="text-caption text-[var(--text-tertiary)]">
              Placement tests use seed mailboxes at {Object.values(PROVIDER_LABELS).slice(0, 3).join(', ')} and others.{' '}
              <Link to="/placement" className="text-[var(--indigo-text)] hover:underline">Run one</Link>
            </p>
          </div>
        )}
      </AsyncPanel>

      <BulkPace
        open={!!pace}
        onClose={() => setPace(null)}
        mailboxes={paceTargets}
        initialIds={pace?.ids}
        // "Set a careful pace" from a struggling mailbox starts at the careful presets.
        initialPace={pace?.careful ? { limit: DAILY_LIMIT_PRESETS[0].value, min: GAP_PRESETS[GAP_PRESETS.length - 1].min, max: GAP_PRESETS[GAP_PRESETS.length - 1].max } : undefined}
      />
    </div>
  );
}

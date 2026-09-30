import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ShieldCheck, ShieldOff, Moon, Gauge, TrendingUp, PauseCircle, PlayCircle, MailX,
  CalendarCheck2, Hand, ChevronDown, Loader2, Database, CircleCheck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  AUTOPILOT, AUTOPILOT_STATE_LABELS, formatTime,
  type AutopilotEventKind, type AutopilotMailbox, type AutopilotState,
} from '@lemlist/shared';
import { autopilotApi } from '../../api/autopilot.api';
import { Toggle } from '../ui/Toggle';
import { cn, formatRelativeTime, formatTimeUntil } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   What the autopilot is doing, and the three ways to overrule it.

   Built to be trusted rather than admired: every mailbox says what state
   it is in, why, and on what evidence; every action it took is in the log
   in plain words; and each one can be undone with one click. An autopilot
   nobody can see into is one people switch off the first time it surprises
   them.
   ═══════════════════════════════════════════════════════════════════════ */

const STATE_TONE: Record<AutopilotState, { pill: string; bar: string }> = {
  active: { pill: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400', bar: 'bg-emerald-500' },
  slowed: { pill: 'bg-amber-500/10 text-amber-700 dark:text-amber-400', bar: 'bg-amber-500' },
  resting: { pill: 'bg-rose-500/10 text-rose-700 dark:text-rose-400', bar: 'bg-rose-500' },
  recovering: { pill: 'bg-[var(--indigo-subtle)] text-[var(--indigo)]', bar: 'bg-[var(--indigo)]' },
};

const EVENT_ICON: Record<AutopilotEventKind, { icon: React.ElementType; tone: string }> = {
  rest: { icon: Moon, tone: 'text-rose-500 bg-rose-500/10' },
  slow: { icon: Gauge, tone: 'text-amber-600 bg-amber-500/10' },
  recovering: { icon: TrendingUp, tone: 'text-[var(--indigo)] bg-[var(--indigo-subtle)]' },
  recovery_step: { icon: TrendingUp, tone: 'text-[var(--indigo)] bg-[var(--indigo-subtle)]' },
  recovered: { icon: CircleCheck, tone: 'text-emerald-600 bg-emerald-500/10' },
  full_speed: { icon: CircleCheck, tone: 'text-emerald-600 bg-emerald-500/10' },
  hold: { icon: PauseCircle, tone: 'text-amber-600 bg-amber-500/10' },
  release: { icon: PlayCircle, tone: 'text-emerald-600 bg-emerald-500/10' },
  manual_resume: { icon: Hand, tone: 'text-[var(--text-secondary)] bg-[var(--bg-elevated)]' },
  bounces_found: { icon: MailX, tone: 'text-rose-500 bg-rose-500/10' },
  weekly: { icon: CalendarCheck2, tone: 'text-[var(--indigo)] bg-[var(--indigo-subtle)]' },
};

export function AutopilotPanel() {
  const qc = useQueryClient();
  const [showRules, setShowRules] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['autopilot'],
    queryFn: autopilotApi.status,
    // It acts every ten minutes; a minute's staleness is honest enough.
    refetchInterval: 60_000,
    meta: { silentError: true },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['autopilot'] });
    qc.invalidateQueries({ queryKey: ['smtp-accounts'] });
    qc.invalidateQueries({ queryKey: ['readiness'] });
  };
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => autopilotApi.setEnabled(enabled),
    onSuccess: (r) => { toast.success(r.enabled ? 'Autopilot on' : 'Autopilot off - every mailbox back to full volume'); refresh(); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not change the autopilot'),
  });
  const resume = useMutation({
    mutationFn: (id: string) => autopilotApi.resume(id),
    onSuccess: () => { toast.success('Resumed at full volume'); refresh(); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not resume it'),
  });
  const release = useMutation({
    mutationFn: (provider: string) => autopilotApi.releaseHold(provider),
    onSuccess: () => { toast.success('Pause lifted'); refresh(); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not lift the pause'),
  });

  if (isLoading) return <div className="h-64 rounded-2xl bg-[var(--bg-elevated)] animate-pulse" />;

  if (!data || !data.ready) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5" data-autopilot-pending>
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] text-[var(--indigo)]">
          <Database className="h-4 w-4" />
        </span>
        <div>
          <p className="text-strong font-semibold text-[var(--text-primary)]">One database update to switch this on</p>
          <p className="mt-1 text-body text-[var(--text-secondary)]">
            Run migration 077 in the Supabase SQL editor. The autopilot starts watching your mailboxes within ten minutes of it.
          </p>
        </div>
      </div>
    );
  }

  const resting = data.mailboxes.filter((m) => m.state === 'resting');
  const struggling = data.mailboxes.filter((m) => m.state !== 'active');
  const healthy = data.mailboxes.length - resting.length;
  const w = data.week;

  const headline = !data.enabled
    ? 'Off. Nothing is rested, slowed or paused automatically.'
    : data.mailboxes.length === 0
      ? 'Connect a mailbox and the autopilot starts watching it.'
      : struggling.length === 0 && data.holds.length === 0
        ? `All ${data.mailboxes.length === 1 ? 'your mailbox' : `${data.mailboxes.length} mailboxes`} at full speed.`
        : resting.length > 0
          ? `Resting ${resting.length} mailbox${resting.length === 1 ? '' : 'es'}${healthy > 0 ? ` - campaigns carry on through the other ${healthy}` : ''}.`
          : `${struggling.length} mailbox${struggling.length === 1 ? '' : 'es'} held back while ${struggling.length === 1 ? 'it settles' : 'they settle'}${data.holds.length ? `, ${data.holds.length} provider paused` : ''}.`;

  return (
    <div className="space-y-4" data-autopilot>
      {/* The switch and the one line that says how things stand. */}
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <div className="flex items-start gap-3">
          <span className={cn(
            'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl',
            data.enabled ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]',
          )}>
            {data.enabled ? <ShieldCheck className="h-5 w-5" /> : <ShieldOff className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-heading font-semibold text-[var(--text-primary)]">Deliverability autopilot</p>
            <p className="mt-0.5 text-body text-[var(--text-secondary)]">{headline}</p>
            {data.enabled && data.last_run_at && (
              <p className="mt-1 text-caption text-[var(--text-tertiary)]">Last checked {formatRelativeTime(data.last_run_at)} · checks every 10 minutes</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {toggle.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--text-tertiary)]" />}
            <Toggle
              checked={data.enabled}
              onChange={(v) => toggle.mutate(v)}
              disabled={toggle.isPending}
              aria-label="Deliverability autopilot"
            />
          </div>
        </div>

        {/* The week, in five numbers. */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5" data-autopilot-week>
          <WeekStat label="Rested" value={w.rests} hint={w.rested_hours ? `${w.rested_hours}h of rest` : undefined} />
          <WeekStat label="Slowed" value={w.slowdowns} />
          <WeekStat label="Back to full" value={w.recoveries} />
          <WeekStat label="Providers paused" value={w.holds} />
          <WeekStat label="Bounces caught" value={w.bounces_found} hint="from returned-mail notices" />
        </div>
        <p className="mt-2 text-caption text-[var(--text-tertiary)]">The last 7 days.</p>
      </div>

      {/* Every mailbox: state, share of its volume, why, and the evidence. */}
      {data.mailboxes.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          <div className="border-b border-[var(--border-subtle)] px-4 py-3">
            <p className="text-strong font-semibold text-[var(--text-primary)]">Mailboxes</p>
          </div>
          <ul className="divide-y divide-[var(--border-subtle)]">
            {data.mailboxes.map((m) => (
              <MailboxRow
                key={m.id}
                m={m}
                enabled={data.enabled}
                busy={resume.isPending && resume.variables === m.id}
                onResume={() => resume.mutate(m.id)}
              />
            ))}
          </ul>
        </div>
      )}

      {data.holds.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]" data-autopilot-holds>
          <div className="border-b border-[var(--border-subtle)] px-4 py-3">
            <p className="text-strong font-semibold text-[var(--text-primary)]">Paused providers</p>
            <p className="text-caption text-[var(--text-tertiary)]">Mail to these waits, and goes out when the pause ends.</p>
          </div>
          <ul className="divide-y divide-[var(--border-subtle)]">
            {data.holds.map((h) => (
              <li key={h.provider} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                <PauseCircle className="h-4 w-4 flex-shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-body font-medium text-[var(--text-primary)]">{h.provider}</p>
                  {h.reason && <p className="text-caption text-[var(--text-tertiary)]">{h.reason}</p>}
                </div>
                <span className="text-caption tabular text-[var(--text-secondary)]">until {formatTime(h.held_until)}</span>
                <button
                  onClick={() => release.mutate(h.provider)}
                  disabled={release.isPending}
                  className="h-7 rounded-lg border border-[var(--border-subtle)] px-2.5 text-caption font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  Send now
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* What it did, in words. */}
      <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]" data-autopilot-log>
        <div className="border-b border-[var(--border-subtle)] px-4 py-3">
          <p className="text-strong font-semibold text-[var(--text-primary)]">What it did</p>
        </div>
        {data.events.length === 0 ? (
          <p className="px-4 py-6 text-center text-body text-[var(--text-tertiary)]">
            Nothing yet. Everything it does - and why - will be written here.
          </p>
        ) : (
          <ol className="divide-y divide-[var(--border-subtle)]">
            {data.events.map((e) => {
              const { icon: Icon, tone } = EVENT_ICON[e.kind] || EVENT_ICON.manual_resume;
              return (
                <li key={e.id} className="flex items-start gap-3 px-4 py-3">
                  <span className={cn('mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg', tone)}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-body font-medium text-[var(--text-primary)]">{e.title}</p>
                    {e.detail && <p className="mt-0.5 text-caption leading-relaxed text-[var(--text-tertiary)]">{e.detail}</p>}
                  </div>
                  <span className="flex-shrink-0 text-caption text-[var(--text-tertiary)]">{formatRelativeTime(e.created_at)}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* The rules, for anyone who wants to know exactly when it acts. */}
      <div className="rounded-2xl border border-dashed border-[var(--border-subtle)]">
        <button
          type="button"
          onClick={() => setShowRules((v) => !v)}
          aria-expanded={showRules}
          className="flex w-full items-center gap-2 px-4 h-11 text-left text-body font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          How it decides
          <ChevronDown className={cn('ml-auto h-4 w-4 transition-transform', showRules && 'rotate-180')} />
        </button>
        {showRules && (
          <ul className="space-y-1.5 px-4 pb-4 text-caption leading-relaxed text-[var(--text-secondary)]" data-autopilot-rules>
            <li><span className="font-semibold text-[var(--text-primary)]">Slow</span> - half volume when a mailbox's bounce rate is confidently above {AUTOPILOT.SLOW_BOUNCE * 100}% (after {AUTOPILOT.MIN_SENDS} sends), or a receiving server refuses it as a sender.</li>
            <li><span className="font-semibold text-[var(--text-primary)]">Rest</span> - no sending for {AUTOPILOT.REST_HOURS / 24} days when it is confidently above {AUTOPILOT.REST_BOUNCE * 100}%, or {AUTOPILOT.REST_BLOCKS} servers refuse it. {AUTOPILOT.REST_HOURS_REPEAT / 24} days if it rested in the last two weeks.</li>
            <li><span className="font-semibold text-[var(--text-primary)]">Recover</span> - back at {AUTOPILOT.RECOVERY_STEPS.map((s) => `${s * 100}%`).join(', ')}, then full, a day at a time - judged only on what it sends after the rest.</li>
            <li><span className="font-semibold text-[var(--text-primary)]">Domain</span> - two mailboxes on one domain refused as senders rests the rest of that domain's mailboxes too.</li>
            <li><span className="font-semibold text-[var(--text-primary)]">Providers</span> - {AUTOPILOT.HOLD_BLOCKS} or more refusals from one provider in a day (and at least {AUTOPILOT.HOLD_SHARE * 100}% of sends there) pauses mail to it for {AUTOPILOT.HOLD_HOURS} hours, {AUTOPILOT.HOLD_HOURS_REPEAT} if it happens again that week.</li>
            <li><span className="font-semibold text-[var(--text-primary)]">Bounce notices</span> - returned-mail emails are read, and each bounce stops that address, counts against the mailbox that sent it, and is checked by the bounce guard.</li>
          </ul>
        )}
      </div>
    </div>
  );
}

function WeekStat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-xl bg-[var(--bg-elevated)] px-3 py-2.5">
      <p className="text-title font-semibold tabular text-[var(--text-primary)]">{value}</p>
      <p className="text-caption text-[var(--text-secondary)]">{label}</p>
      {hint && value > 0 && <p className="text-micro text-[var(--text-tertiary)]">{hint}</p>}
    </div>
  );
}

function MailboxRow({ m, enabled, busy, onResume }: {
  m: AutopilotMailbox; enabled: boolean; busy: boolean; onResume: () => void;
}) {
  const tone = STATE_TONE[m.state];
  const failures = m.evidence.bounced + m.evidence.blocked;
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4" data-autopilot-mailbox={m.state}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-body font-medium text-[var(--text-primary)]">{m.email_address}</p>
          <span className={cn('inline-flex h-[20px] items-center rounded-md px-1.5 text-micro font-bold', tone.pill)}>
            {AUTOPILOT_STATE_LABELS[m.state]}
          </span>
          {m.state === 'resting' && m.rest_until && (
            <span className="text-caption text-[var(--text-tertiary)]">back {formatTimeUntil(m.rest_until)}</span>
          )}
        </div>
        {m.reason && m.state !== 'active' && (
          <p className="mt-0.5 text-caption leading-relaxed text-[var(--text-secondary)]">{m.reason.charAt(0).toUpperCase() + m.reason.slice(1)}.</p>
        )}
        <p className="mt-0.5 text-caption tabular text-[var(--text-tertiary)]">
          {m.evidence.sent.toLocaleString()} sent · {m.evidence.bounced} bounced · {m.evidence.blocked} refused
          {m.state === 'recovering' ? ' since it came back' : ' in 7 days'}
          {m.evidence.sent > 0 && failures > 0 ? ` (${((failures / m.evidence.sent) * 100).toFixed(1)}%)` : ''}
        </p>
      </div>
      <div className="flex items-center gap-3 sm:w-64">
        <div className="flex-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-elevated)]" title={`${Math.round(m.share * 100)}% of its usual volume`}>
            <div className={cn('h-full rounded-full transition-all', tone.bar)} style={{ width: `${Math.max(m.share * 100, m.share > 0 ? 4 : 0)}%` }} />
          </div>
          <p className="mt-1 text-micro tabular text-[var(--text-tertiary)]">{Math.round(m.share * 100)}% of usual volume</p>
        </div>
        {enabled && m.state !== 'active' && (
          <button
            onClick={onResume}
            disabled={busy}
            className="h-7 flex-shrink-0 rounded-lg border border-[var(--border-subtle)] px-2.5 text-caption font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
            title="Put it back to full volume now. The autopilot judges it only on what it sends from here."
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Resume now'}
          </button>
        )}
      </div>
    </li>
  );
}

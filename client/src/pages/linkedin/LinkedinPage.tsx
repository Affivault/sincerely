import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { linkedinApi, type LinkedinSettings } from '../../api/linkedin.api';
import { PageHeader } from '../../components/shared/PageHeader';
import { Spinner } from '../../components/ui/Spinner';
import { cn } from '../../lib/utils';
import { Linkedin, ShieldCheck, Clock, Gauge, AlertTriangle, ExternalLink, Play, Pause } from 'lucide-react';
import toast from 'react-hot-toast';

/* ═══════════════════════════════════════════════════════════════════════
   LinkedIn.

   The campaign steps are built in the flow builder; this page is about the
   thing that carries them out and, mostly, about the limits it works
   inside. Every control here exists to make the agent look less like
   software — because the failure mode isn't "a step didn't send", it's
   "LinkedIn restricted the account".
   ═══════════════════════════════════════════════════════════════════════ */

const DAYS = [
  { n: 1, label: 'Mon' }, { n: 2, label: 'Tue' }, { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' }, { n: 5, label: 'Fri' }, { n: 6, label: 'Sat' }, { n: 7, label: 'Sun' },
];

function Meter({ label, used, limit, tone }: { label: string; used: number; limit: number; tone: string }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="card px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-[var(--text-tertiary)]">{label}</span>
        <span className="text-[11.5px] font-semibold tabular text-[var(--text-secondary)]">
          {used}<span className="text-[var(--text-muted)] font-normal"> / {limit}</span>
        </span>
      </div>
      <div className="mt-2 h-1 rounded-full bg-[var(--bg-active)] overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: tone }} />
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange, min, max, suffix, hint }: {
  label: string; value: number; onChange: (n: number) => void;
  min: number; max: number; suffix?: string; hint?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[11.5px] font-medium text-[var(--text-secondary)] mb-1">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-24 h-8 rounded-lg border border-[var(--border-default)] bg-[var(--bg-app)] px-2 text-[12.5px] tabular text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
        />
        {suffix && <span className="text-[11.5px] text-[var(--text-tertiary)]">{suffix}</span>}
      </span>
      {hint && <span className="block mt-1 text-[10.5px] text-[var(--text-muted)]">{hint}</span>}
    </label>
  );
}

export function LinkedinPage() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Partial<LinkedinSettings>>({});

  const { data, isLoading, error } = useQuery({
    queryKey: ['linkedin', 'status'],
    queryFn: linkedinApi.status,
    // The extension checks in every minute; this keeps the dot honest.
    refetchInterval: 30_000,
  });

  const save = useMutation({
    mutationFn: (patch: Partial<LinkedinSettings>) => linkedinApi.update(patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['linkedin'] }); setDraft({}); toast.success('Saved'); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save that'),
  });

  // Quick actions (header toggle, "Resume now") send a bare partial patch
  // outside the staged draft — they must not clear `draft` on success, or a
  // pending edit to limits/pacing/hours gets silently discarded.
  const saveQuick = useMutation({
    mutationFn: (patch: Partial<LinkedinSettings>) => linkedinApi.update(patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['linkedin'] }); toast.success('Saved'); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save that'),
  });

  const needsMigration = (error as any)?.response?.status === 503;

  if (needsMigration) {
    return (
      <div>
        <PageHeader title="LinkedIn" description="Run LinkedIn steps from your own browser" />
        <div className="panel px-5 py-8 text-center">
          <Linkedin className="h-6 w-6 mx-auto text-[var(--text-muted)] mb-2" />
          <p className="text-[14px] font-semibold text-[var(--text-primary)]">Not set up yet</p>
          <p className="text-[12.5px] text-[var(--text-tertiary)] mt-1 max-w-md mx-auto">
            Run migration <span className="font-mono text-[11.5px]">040_linkedin_agent.sql</span> in Supabase, then reload.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading || !data) return <div className="flex h-64 items-center justify-center"><Spinner size="lg" /></div>;

  const s = { ...data.settings, ...draft };
  const set = (patch: Partial<LinkedinSettings>) => setDraft((d) => ({ ...d, ...patch }));
  const dirty = Object.keys(draft).length > 0;
  const pausedNow = !!s.paused_until && new Date(s.paused_until) > new Date();

  return (
    <div className="space-y-4 max-w-4xl">
      <PageHeader
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/10 border border-sky-500/20">
            <Linkedin className="h-4 w-4 text-sky-600 dark:text-sky-400" />
          </span>
        }
        title="LinkedIn"
        description="Runs the LinkedIn steps of your campaigns in your own browser"
        actions={
          <button
            onClick={() => saveQuick.mutate({ enabled: !s.enabled })}
            className={s.enabled ? 'btn-secondary' : 'btn-primary'}
          >
            {s.enabled ? <><Pause className="h-3.5 w-3.5" /> Turn off</> : <><Play className="h-3.5 w-3.5" /> Turn on</>}
          </button>
        }
      />

      {/* Where it stands right now */}
      <div className="panel px-4 py-3 flex items-center gap-3 flex-wrap">
        <span className={cn(
          'h-2 w-2 rounded-full flex-shrink-0',
          !s.enabled ? 'bg-[var(--text-muted)]'
            : pausedNow ? 'bg-amber-500'
            : data.connected ? 'bg-emerald-500' : 'bg-[var(--text-muted)]',
        )} />
        <span className="text-[12.5px] text-[var(--text-primary)] font-medium">
          {!s.enabled ? 'Turned off'
            : pausedNow ? 'Paused'
            : data.connected ? 'Extension connected' : 'Waiting for the extension'}
        </span>
        {pausedNow && s.pause_reason && (
          <span className="text-[11.5px] text-amber-600 dark:text-amber-400">{s.pause_reason}</span>
        )}
        {!data.connected && s.enabled && !pausedNow && (
          <span className="text-[11.5px] text-[var(--text-tertiary)]">
            Install the extension and paste an API key — nothing runs without it.
          </span>
        )}
        <span className="flex-1" />
        <span className="text-[11.5px] text-[var(--text-tertiary)]">
          <span className="tabular font-semibold text-[var(--text-secondary)]">{data.queued}</span> step{data.queued === 1 ? '' : 's'} waiting
        </span>
        {pausedNow && (
          <button
            onClick={() => saveQuick.mutate({ paused_until: null, pause_reason: null } as any)}
            className="text-[11.5px] font-semibold text-[var(--indigo)] hover:underline"
          >
            Resume now
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Meter label="Invites today" used={data.today.connects} limit={s.daily_connect_limit} tone="var(--indigo)" />
        <Meter label="Messages today" used={data.today.messages} limit={s.daily_message_limit} tone="#0ea5e9" />
        <Meter label="Profile visits today" used={data.today.visits} limit={s.daily_visit_limit} tone="#10b981" />
      </div>

      {/* Why this is shaped the way it is */}
      <div className="panel p-4">
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
          <div className="min-w-0 text-[12.5px] text-[var(--text-secondary)] leading-relaxed">
            <p className="font-semibold text-[var(--text-primary)] mb-1">How this works, and why</p>
            <p>
              LinkedIn has no API for connection requests or messages to people you aren't connected to.
              The alternative to a browser extension is storing your LinkedIn session on a server and
              replaying it from a datacentre — which is what gets accounts restricted. Here the action
              happens in your browser, from your IP, in your session. Nothing about your LinkedIn login
              is ever sent to Sincerely; the extension only asks what to do and reports back.
            </p>
            <p className="mt-2">
              LinkedIn's terms don't permit automation of any kind, so the limits below are the point.
              They default well under the thresholds where accounts get flagged — around 100 invites a
              week. On a new or quiet account, start lower.
            </p>
            <Link to="/developer" className="inline-flex items-center gap-1 mt-2 font-medium text-[var(--indigo)] hover:underline">
              Get your API key <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>

      {/* Limits */}
      <div className="panel p-4">
        <div className="flex items-center gap-2 mb-3">
          <Gauge className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          <h2 className="text-[12.5px] font-semibold text-[var(--text-primary)]">Daily limits</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <NumberField
            label="Connection requests" value={s.daily_connect_limit} min={0} max={40}
            onChange={(n) => set({ daily_connect_limit: n })} suffix="a day"
            hint="LinkedIn flags around 100 a week."
          />
          <NumberField
            label="Messages" value={s.daily_message_limit} min={0} max={100}
            onChange={(n) => set({ daily_message_limit: n })} suffix="a day"
          />
          <NumberField
            label="Profile visits" value={s.daily_visit_limit} min={0} max={200}
            onChange={(n) => set({ daily_visit_limit: n })} suffix="a day"
          />
        </div>
      </div>

      {/* Pacing */}
      <div className="panel p-4">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          <h2 className="text-[12.5px] font-semibold text-[var(--text-primary)]">Pacing</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <NumberField
            label="Shortest gap between actions" value={s.min_gap_seconds} min={20} max={3600}
            onChange={(n) => set({ min_gap_seconds: n })} suffix="seconds"
          />
          <NumberField
            label="Longest gap" value={s.max_gap_seconds} min={30} max={7200}
            onChange={(n) => set({ max_gap_seconds: n })} suffix="seconds"
            hint="A random gap is picked in this range each time — a fixed interval is the most recognisable pattern there is."
          />
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-[11.5px] font-medium text-[var(--text-secondary)] mb-1">Working hours</span>
            <span className="flex items-center gap-2">
              <input
                type="time" value={s.work_start}
                onChange={(e) => set({ work_start: e.target.value })}
                className="h-8 rounded-lg border border-[var(--border-default)] bg-[var(--bg-app)] px-2 text-[12.5px] text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
              />
              <span className="text-[11.5px] text-[var(--text-tertiary)]">to</span>
              <input
                type="time" value={s.work_end}
                onChange={(e) => set({ work_end: e.target.value })}
                className="h-8 rounded-lg border border-[var(--border-default)] bg-[var(--bg-app)] px-2 text-[12.5px] text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
              />
            </span>
            <span className="block mt-1 text-[10.5px] text-[var(--text-muted)]">In {s.timezone}.</span>
          </label>

          <div>
            <span className="block text-[11.5px] font-medium text-[var(--text-secondary)] mb-1">Working days</span>
            <div className="flex flex-wrap gap-1">
              {DAYS.map((d) => {
                const on = s.work_days?.includes(d.n);
                return (
                  <button
                    key={d.n}
                    onClick={() => set({
                      work_days: on
                        ? s.work_days.filter((x) => x !== d.n)
                        : [...(s.work_days || []), d.n].sort((a, b) => a - b),
                    })}
                    className={cn(
                      'h-8 w-11 rounded-lg text-[11.5px] font-semibold transition-colors',
                      on
                        ? 'bg-[var(--indigo)] text-white'
                        : 'border border-[var(--border-default)] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]',
                    )}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {dirty && (
        <div className="sticky bottom-3 flex items-center gap-2 panel px-4 py-2.5 shadow-[var(--shadow-lg)]">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
          <span className="text-[12px] text-[var(--text-secondary)]">Unsaved changes</span>
          <span className="flex-1" />
          <button onClick={() => setDraft({})} className="btn-secondary">Discard</button>
          <button
            onClick={() => save.mutate(draft)}
            disabled={save.isPending}
            className="btn-primary"
          >
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
    </div>
  );
}

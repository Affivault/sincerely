import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { linkedinApi, type LinkedinSettings, type LinkedinStatus, type LinkedinActivityItem } from '../../api/linkedin.api';
import { PageHeader } from '../../components/shared/PageHeader';
import { PageSkeleton, Skeleton } from '../../components/ui/Skeleton';
import { LinkedinAgentNotice } from '../../components/linkedin/LinkedinAgentNotice';
import { useExtensionBridge } from '../../hooks/useExtensionBridge';
import { cn, formatRelativeTime } from '../../lib/utils';
import {
  Linkedin, ShieldCheck, Clock, Gauge, AlertTriangle, ExternalLink, Play, Pause, Check, Chrome,
  UserPlus, MessageSquare, Eye, Inbox, UserCheck, Undo2, Sparkles, Activity, Bot,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  LINKEDIN_WEEKLY_CONNECT_DEFAULT, LINKEDIN_WEEKLY_CONNECT_MAX, LINKEDIN_SKIP_AFTER_DAYS_DEFAULT,
  LINKEDIN_WITHDRAW_AFTER_DAYS_DEFAULT, LINKEDIN_UPKEEP_LIMITS,
} from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   LinkedIn.

   The campaign steps are built in the flow builder; this page is about the
   thing that carries them out and, mostly, about the limits it works
   inside. Every control here exists to make the agent look less like
   software — because the failure mode isn't "a step didn't send", it's
   "LinkedIn restricted the account".
   ═══════════════════════════════════════════════════════════════════════ */

/** The zone this browser is in, which is almost always the user's own. */
const BROWSER_TZ = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
})();

const DAYS = [
  { n: 1, label: 'Mon' }, { n: 2, label: 'Tue' }, { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' }, { n: 5, label: 'Fri' }, { n: 6, label: 'Sat' }, { n: 7, label: 'Sun' },
];

function Meter({ label, used, limit, tone }: { label: string; used: number; limit: number; tone: string }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="card px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-caption font-medium text-[var(--text-tertiary)]">{label}</span>
        <span className="text-caption font-semibold tabular text-[var(--text-secondary)]">
          {used}<span className="text-[var(--text-tertiary)] font-normal"> / {limit}</span>
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
      <span className="block text-caption font-medium text-[var(--text-secondary)] mb-1">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-24 h-8 rounded-lg border border-[var(--border-default)] bg-[var(--bg-app)] px-2 text-body tabular text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
        />
        {suffix && <span className="text-caption text-[var(--text-tertiary)]">{suffix}</span>}
      </span>
      {hint && <span className="block mt-1 text-micro text-[var(--text-tertiary)]">{hint}</span>}
    </label>
  );
}

/* ── Getting it running ────────────────────────────────────────────────
   Four things have to be true before a LinkedIn step happens by itself, and
   until now the page only ever said whether the last one was. Each step
   ticks itself off from what the app can actually see: the extension
   answering this page, the extension checking in with the server, and
   LinkedIn not having signed it out. */
function SetupSteps({ data }: { data: LinkedinStatus }) {
  const bridge = useExtensionBridge();
  const qc = useQueryClient();
  const installed = bridge.present || !!data.ever_connected;
  const linked = !!data.ever_connected || bridge.result?.ok === true;
  const signedIn = !!data.connected && data.settings.pause_kind !== 'logged_out';
  const running = !!data.connected && data.settings.enabled && !data.needs_resume;

  useEffect(() => {
    if (bridge.result?.ok) {
      toast.success('Extension connected. It checks in within a minute.');
      qc.invalidateQueries({ queryKey: ['linkedin'] });
    } else if (bridge.result?.error) {
      toast.error(bridge.result.error);
    }
  }, [bridge.result, qc]);

  const steps: Array<{ done: boolean; title: string; body: React.ReactNode }> = [
    {
      done: installed,
      title: 'Install the Sincerely extension in Chrome',
      body: installed
        ? `Installed${bridge.version ? ` (version ${bridge.version})` : ''}.`
        : 'Unzip the extension you were sent, open the Extensions page in Chrome, switch on Developer mode and choose Load unpacked. Then reload this page.',
    },
    {
      done: linked,
      title: 'Connect it to your Sincerely account',
      body: linked ? 'Connected.' : bridge.present ? (
        <button onClick={bridge.connect} disabled={bridge.connecting} className="btn-primary mt-1">
          <Chrome className="h-3.5 w-3.5" /> {bridge.connecting ? 'Connecting…' : 'Connect extension'}
        </button>
      ) : 'One click once it is installed: we create its key and hand it over, nothing to copy.',
    },
    {
      done: signedIn,
      title: 'Sign in to LinkedIn in the same Chrome',
      body: signedIn ? 'Signed in, as far as the agent can tell.' : (
        <a href="https://www.linkedin.com/feed/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-[var(--indigo-text)] hover:underline">
          Open LinkedIn <ExternalLink className="h-3 w-3" />
        </a>
      ),
    },
    {
      done: running,
      title: 'Agent connected',
      body: running
        ? 'LinkedIn steps now run by themselves, inside the limits below. You only hear from it when it needs you.'
        : !data.settings.enabled && linked
          ? 'The agent is turned off. Turn it on at the top of this page.'
          : 'Switches itself on the first time the extension checks in.',
    },
  ];

  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 mb-3">
        <Chrome className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        <h2 className="text-body font-semibold text-[var(--text-primary)]">Get the agent running</h2>
        <span className="text-caption text-[var(--text-tertiary)] tabular ml-auto">
          {steps.filter((x) => x.done).length} of {steps.length}
        </span>
      </div>
      <ol className="space-y-3">
        {steps.map((step, i) => (
          <li key={step.title} className="flex items-start gap-3">
            <span className={cn(
              'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-micro font-semibold',
              step.done ? 'bg-emerald-500 text-white' : 'border border-[var(--border-default)] text-[var(--text-tertiary)]',
            )}>
              {step.done ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <div className="min-w-0">
              <p className={cn('text-body font-medium', step.done ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]')}>{step.title}</p>
              <div className="text-caption text-[var(--text-tertiary)] mt-0.5">{step.body}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

const ACTIVITY_META: Record<string, { label: string; icon: typeof Linkedin }> = {
  connect: { label: 'Invite', icon: UserPlus },
  message: { label: 'Message', icon: MessageSquare },
  visit: { label: 'Profile visit', icon: Eye },
  check: { label: 'Invite check', icon: UserCheck },
  withdraw: { label: 'Withdrawal', icon: Undo2 },
  inbox: { label: 'Inbox read', icon: Inbox },
  enrich: { label: 'Enrichment', icon: Sparkles },
  attention: { label: 'Needs you', icon: AlertTriangle },
  agent: { label: 'Agent', icon: Bot },
};

const STATE_TONE: Record<string, string> = {
  queued: 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]',
  done: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400',
  skipped: 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]',
  failed: 'bg-amber-500/12 text-amber-700 dark:text-amber-400',
};

/* What the agent did, as a log rather than a to-do list. LinkedIn steps
   used to sit in Activities as chores even while the agent was doing them;
   here they are a record: queued, done, or skipped and why. */
function ActivityLog() {
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['linkedin', 'activity'],
    queryFn: () => linkedinApi.activity(60),
    refetchInterval: 30_000,
  });
  const [filter, setFilter] = useState<'all' | 'queued'>('all');
  const shown = filter === 'queued' ? items.filter((i) => i.state === 'queued') : items;
  const queued = items.filter((i) => i.state === 'queued').length;

  return (
    <div className="panel">
      <div className="flex items-center gap-2 px-4 pt-4 pb-2">
        <Activity className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        <h2 className="text-body font-semibold text-[var(--text-primary)]">What the agent is doing</h2>
        <span className="flex-1" />
        {(['all', 'queued'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'h-6 px-2 rounded-md text-caption font-medium transition-colors',
              filter === f ? 'bg-[var(--bg-active)] text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
            )}
          >
            {f === 'all' ? 'Everything' : `Queued (${queued})`}
          </button>
        ))}
      </div>
      {isLoading ? (
        <div className="px-4 pb-4 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
      ) : shown.length === 0 ? (
        <p className="px-4 pb-4 text-caption text-[var(--text-tertiary)]">
          {filter === 'queued' ? 'Nothing waiting.' : 'Nothing yet. Steps from running campaigns show up here as the agent works through them.'}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">
          {shown.map((item: LinkedinActivityItem) => {
            const meta = ACTIVITY_META[item.kind] || { label: item.kind, icon: Linkedin };
            const Icon = meta.icon;
            return (
              <li key={item.id} className="flex items-start gap-3 px-4 py-2.5">
                <Icon className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-[var(--text-tertiary)]" />
                <div className="min-w-0 flex-1">
                  <p className="text-body text-[var(--text-primary)] truncate">
                    <span className="font-medium">{meta.label}</span>
                    {item.contact_name && (
                      <>
                        <span className="text-[var(--text-tertiary)]"> · </span>
                        {item.contact_id
                          ? <Link to={`/contacts/${item.contact_id}`} className="hover:underline">{item.contact_name}</Link>
                          : item.contact_name}
                      </>
                    )}
                  </p>
                  {item.detail && <p className="text-caption text-[var(--text-tertiary)] truncate" title={item.detail}>{item.detail}</p>}
                </div>
                <span className={cn('inline-flex items-center h-5 px-1.5 rounded text-micro font-semibold capitalize flex-shrink-0', STATE_TONE[item.state] || STATE_TONE.skipped)}>
                  {item.state}
                </span>
                <span className="text-caption text-[var(--text-tertiary)] tabular flex-shrink-0 w-16 text-right">
                  {formatRelativeTime(item.at)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
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

  /*
   * Every account starts on 'UTC', the column default, and nothing ever
   * offered a way to change it - so the working hours below were UTC hours
   * for everyone, and the agent ran at night for anyone far from London.
   * When the saved zone is still that default and the browser knows better,
   * the browser's zone is staged as an unsaved change: visible, and one
   * click from saved, rather than written behind the user's back.
   */
  const staged = useRef(false);
  useEffect(() => {
    if (staged.current || !data) return;
    staged.current = true;
    if (data.settings.timezone === 'UTC' && BROWSER_TZ !== 'UTC') {
      setDraft((d) => ({ timezone: BROWSER_TZ, ...d }));
    }
  }, [data]);

  const savedZone = data?.settings.timezone || 'UTC';
  const zones = useMemo(() => {
    // The saved and browser zones are always offered: some browsers leave
    // "UTC" out of this list, and a select without its value shows the
    // first entry instead.
    let all: string[] = [];
    try { all = ((Intl as any).supportedValuesOf?.('timeZone') as string[] | undefined) || []; } catch { /* old browser */ }
    return [...new Set([savedZone, BROWSER_TZ, 'UTC', ...all])];
  }, [savedZone]);

  const needsMigration = (error as any)?.response?.status === 503;

  if (needsMigration) {
    return (
      <div>
        <PageHeader title="LinkedIn" description="Run LinkedIn steps from your own browser" />
        <div className="panel px-5 py-8 text-center">
          <Linkedin className="h-6 w-6 mx-auto text-[var(--text-tertiary)] mb-2" />
          <p className="text-heading font-semibold text-[var(--text-primary)]">Not set up yet</p>
          <p className="text-body text-[var(--text-tertiary)] mt-1 max-w-md mx-auto">
            Run migration <span className="font-mono text-caption">040_linkedin_agent.sql</span> in Supabase, then reload.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading || !data) return <PageSkeleton variant="panels" />;

  const s = { ...data.settings, ...draft };
  const set = (patch: Partial<LinkedinSettings>) => setDraft((d) => ({ ...d, ...patch }));
  const dirty = Object.keys(draft).length > 0;
  const needsResume = !!data.needs_resume;
  const pausedNow = needsResume || (!!s.paused_until && new Date(s.paused_until) > new Date());
  const loggedOut = data.settings.pause_kind === 'logged_out';
  const has093 = data.settings.weekly_connect_limit !== undefined;

  return (
    <>
      <PageHeader
        contentClassName="max-w-4xl"
        icon={Linkedin}
        title="LinkedIn"
        description="Runs the LinkedIn steps of your campaigns in your own browser"
        actions={
          /* A switch, not a verb: the question people ask of this page is
             "is it on?", and a button reading "Turn off" answers it only
             by implication. */
          <button
            role="switch"
            aria-checked={!!s.enabled}
            onClick={() => saveQuick.mutate({ enabled: !s.enabled })}
            disabled={saveQuick.isPending}
            className={s.enabled ? 'btn-secondary' : 'btn-primary'}
            title={s.enabled ? 'The agent carries out LinkedIn steps. Click to turn it off.' : 'LinkedIn steps wait for you by hand. Click to let the agent do them.'}
          >
            {s.enabled ? <><Pause className="h-3.5 w-3.5" /> Agent on</> : <><Play className="h-3.5 w-3.5" /> Agent off: turn on</>}
          </button>
        }
      />
      <div className="space-y-4 max-w-4xl">

      <LinkedinAgentNotice where="page" />

      {/* Where it stands right now */}
      <div className="panel px-4 py-3 flex items-center gap-3 flex-wrap">
        <span className={cn(
          'h-2 w-2 rounded-full flex-shrink-0',
          !s.enabled ? 'bg-[var(--text-muted)]'
            : pausedNow ? 'bg-amber-500'
            : data.connected ? 'bg-emerald-500' : 'bg-[var(--text-muted)]',
        )} />
        <span className="text-body text-[var(--text-primary)] font-medium">
          {!s.enabled ? 'Agent off: LinkedIn steps wait in Activities for you'
            : pausedNow ? 'Agent paused'
            : data.connected ? 'Agent on and connected' : 'Agent on, waiting for the extension'}
        </span>
        {pausedNow && s.pause_reason && (
          <span className="text-caption text-amber-600 dark:text-amber-400">{s.pause_reason}</span>
        )}
        {data.invites && (
          <span className="text-caption text-[var(--text-tertiary)]">
            <span className="tabular font-semibold text-[var(--text-secondary)]">{data.invites.pending}</span> invites pending
            {' · '}
            <span className="tabular font-semibold text-[var(--text-secondary)]">{data.invites.accepted_30d}</span> accepted this month
          </span>
        )}
        <span className="flex-1" />
        <span className="text-caption text-[var(--text-tertiary)]">
          <span className="tabular font-semibold text-[var(--text-secondary)]">{data.queued}</span> step{data.queued === 1 ? '' : 's'} waiting
        </span>
        {pausedNow && !needsResume && (
          <button
            onClick={() => saveQuick.mutate({ paused_until: null, pause_reason: null } as any)}
            className="text-caption font-semibold text-[var(--indigo-text)] hover:underline"
          >
            Resume now
          </button>
        )}
      </div>

      {/* A pause that waits for a person. LinkedIn showed a checkpoint or a
          restriction, or the browser is signed out; resuming on a timer
          would walk straight back into it. */}
      {needsResume && (
        <div className="panel p-4 border-amber-500/40">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-body font-semibold text-[var(--text-primary)]">
                {loggedOut ? 'LinkedIn is signed out in your browser' : 'LinkedIn wants you to take a look'}
              </p>
              <p className="text-body text-[var(--text-secondary)] mt-1 leading-relaxed">
                {loggedOut
                  ? 'The agent opened a profile and LinkedIn asked it to sign in. Nothing was sent and no step was used up. Sign in to LinkedIn in this browser, then resume.'
                  : 'LinkedIn showed a security check or a restriction notice, so the agent stopped and stays stopped until you resume it. Open LinkedIn, clear whatever it is asking for, and give it a day if it mentions a restriction.'}
              </p>
              {s.pause_reason && !loggedOut && (
                <p className="text-caption text-amber-600 dark:text-amber-400 mt-1">{s.pause_reason}</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => saveQuick.mutate({ paused_until: null, pause_reason: null })}
                  disabled={saveQuick.isPending}
                  className="btn-primary"
                >
                  <Play className="h-3.5 w-3.5" />
                  {loggedOut ? "I've signed in, resume" : "I've checked LinkedIn, resume"}
                </button>
                <a
                  href="https://www.linkedin.com/feed/"
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary"
                >
                  Open LinkedIn <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={cn('grid grid-cols-1 gap-3', data.week ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3')}>
        <Meter label="Invites today" used={data.today.connects} limit={s.daily_connect_limit} tone="var(--indigo)" />
        <Meter label="Messages today" used={data.today.messages} limit={s.daily_message_limit} tone="#0ea5e9" />
        <Meter label="Profile visits today" used={data.today.visits} limit={s.daily_visit_limit} tone="#10b981" />
        {data.week && (
          <Meter
            label="Invites this week" used={data.week.connects}
            limit={s.weekly_connect_limit ?? LINKEDIN_WEEKLY_CONNECT_DEFAULT} tone="#8b5cf6"
          />
        )}
      </div>

      {/* The agent's own work, each on a cap of its own, so a busy day of
          invite checks can never eat into the invites themselves. */}
      {data.upkeep && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Meter label="Replies checked today" used={data.today.inbox_reads ?? 0}
            limit={s.daily_inbox_limit ?? LINKEDIN_UPKEEP_LIMITS.daily_inbox_limit.default} tone="#0ea5e9" />
          <Meter label="Invites checked today" used={data.today.checks ?? 0}
            limit={s.daily_check_limit ?? LINKEDIN_UPKEEP_LIMITS.daily_check_limit.default} tone="#10b981" />
          <Meter label="Invites withdrawn today" used={data.today.withdrawals ?? 0}
            limit={s.daily_withdraw_limit ?? LINKEDIN_UPKEEP_LIMITS.daily_withdraw_limit.default} tone="#f59e0b" />
          <Meter label="Profiles enriched today" used={data.today.enrichments ?? 0}
            limit={s.daily_enrich_limit ?? LINKEDIN_UPKEEP_LIMITS.daily_enrich_limit.default} tone="#8b5cf6" />
        </div>
      )}

      {/* Once it is running this is history; until then it is the way in. */}
      {!(data.connected && s.enabled && !needsResume) && <SetupSteps data={data} />}

      <ActivityLog />

      {/* Why this is shaped the way it is */}
      <div className="panel p-4">
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
          <div className="min-w-0 text-body text-[var(--text-secondary)] leading-relaxed">
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
            <Link to="/developer" className="inline-flex items-center gap-1 mt-2 font-medium text-[var(--indigo-text)] hover:underline">
              Get your API key <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>

      {/* Limits */}
      <div className="panel p-4">
        <div className="flex items-center gap-2 mb-3">
          <Gauge className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          <h2 className="text-body font-semibold text-[var(--text-primary)]">Daily limits</h2>
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
        {/* The week is what LinkedIn actually measures. Fifteen a day on
            every working day is 75; the cap stops a raised daily limit or a
            seven-day week from quietly reaching the point accounts get
            flagged at. */}
        <div className="mt-4">
          {has093 ? (
            <NumberField
              label="Connection requests per week"
              value={s.weekly_connect_limit ?? LINKEDIN_WEEKLY_CONNECT_DEFAULT}
              min={0} max={LINKEDIN_WEEKLY_CONNECT_MAX}
              onChange={(n) => set({ weekly_connect_limit: n })} suffix="a week"
              hint={`Counted Monday to Sunday in your timezone. ${LINKEDIN_WEEKLY_CONNECT_MAX} at most.`}
            />
          ) : (
            <p className="text-caption text-[var(--text-tertiary)]">
              A weekly invite cap arrives with migration <span className="font-mono">093_linkedin_agent_hardening.sql</span>.
            </p>
          )}
        </div>
      </div>

      {/* Pacing */}
      <div className="panel p-4">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          <h2 className="text-body font-semibold text-[var(--text-primary)]">Pacing</h2>
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
            <span className="block text-caption font-medium text-[var(--text-secondary)] mb-1">Working hours</span>
            <span className="flex items-center gap-2">
              <input
                type="time" value={s.work_start}
                onChange={(e) => set({ work_start: e.target.value })}
                className="h-8 rounded-lg border border-[var(--border-default)] bg-[var(--bg-app)] px-2 text-body text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
              />
              <span className="text-caption text-[var(--text-tertiary)]">to</span>
              <input
                type="time" value={s.work_end}
                onChange={(e) => set({ work_end: e.target.value })}
                className="h-8 rounded-lg border border-[var(--border-default)] bg-[var(--bg-app)] px-2 text-body text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
              />
            </span>
          </label>

          <label className="block">
            <span className="block text-caption font-medium text-[var(--text-secondary)] mb-1">Timezone</span>
            <select
              value={s.timezone || 'UTC'}
              onChange={(e) => set({ timezone: e.target.value })}
              className="h-8 w-full max-w-xs rounded-lg border border-[var(--border-default)] bg-[var(--bg-app)] px-2 text-body text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
            >
              {zones.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
            <span className="block mt-1 text-micro text-[var(--text-tertiary)]">
              Working hours and days, and when the daily count resets, are in this zone.
              {s.timezone !== BROWSER_TZ && (
                <>
                  {' '}
                  <button
                    type="button"
                    onClick={() => set({ timezone: BROWSER_TZ })}
                    className="font-medium text-[var(--indigo-text)] hover:underline"
                  >
                    Use {BROWSER_TZ}
                  </button>
                </>
              )}
            </span>
          </label>

          <div>
            <span className="block text-caption font-medium text-[var(--text-secondary)] mb-1">Working days</span>
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
                      'h-8 w-11 rounded-lg text-caption font-semibold transition-colors',
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

      {/* What happens to a step nobody does */}
      <div className="panel p-4">
        <div className="flex items-center gap-2 mb-1">
          <Clock className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          <h2 className="text-body font-semibold text-[var(--text-primary)]">Steps nobody gets to</h2>
        </div>
        <p className="text-caption text-[var(--text-tertiary)] mb-3 max-w-2xl">
          A LinkedIn step waits for the agent or for you. Left undone, it holds that person's sequence still,
          so after this long it is skipped and the next step goes ahead. While the extension is running,
          a long queue is just the limits working, and nothing is skipped.
        </p>
        {has093 ? (
          <NumberField
            label="Skip an undone LinkedIn step after"
            value={s.skip_task_after_days ?? LINKEDIN_SKIP_AFTER_DAYS_DEFAULT}
            min={0} max={90}
            onChange={(n) => set({ skip_task_after_days: n })} suffix="days"
            hint="0 never skips: the sequence waits for as long as the step does."
          />
        ) : (
          <p className="text-caption text-[var(--text-tertiary)]">
            Needs migration <span className="font-mono">093_linkedin_agent_hardening.sql</span>.
          </p>
        )}
      </div>

      {/* Upkeep: what the agent does between campaign steps, so nobody has
          to. Each has a cap of its own, inside the same hours and gaps. */}
      <div className="panel p-4">
        <div className="flex items-center gap-2 mb-1">
          <Bot className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          <h2 className="text-body font-semibold text-[var(--text-primary)]">Between steps</h2>
        </div>
        <p className="text-caption text-[var(--text-tertiary)] mb-3 max-w-2xl">
          The agent reads your LinkedIn messages for replies from people in a campaign (they land in your inbox and
          stop the sequence), looks in on pending invites to see whether they were accepted, withdraws the ones nobody
          answered, and fills a contact's blank title, company and location from any profile it visits. It never
          overwrites something you typed.
        </p>
        {data.upkeep ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <NumberField
              label="Withdraw invites still pending after"
              value={s.withdraw_after_days ?? LINKEDIN_WITHDRAW_AFTER_DAYS_DEFAULT}
              min={0} max={180}
              onChange={(n) => set({ withdraw_after_days: n })} suffix="days"
              hint="0 never withdraws. A pile of stale invites counts against an account."
            />
            <NumberField
              label="Reply checks" value={s.daily_inbox_limit ?? LINKEDIN_UPKEEP_LIMITS.daily_inbox_limit.default}
              min={0} max={LINKEDIN_UPKEEP_LIMITS.daily_inbox_limit.max}
              onChange={(n) => set({ daily_inbox_limit: n })} suffix="a day"
              hint="Spread across your working hours."
            />
            <NumberField
              label="Invite checks" value={s.daily_check_limit ?? LINKEDIN_UPKEEP_LIMITS.daily_check_limit.default}
              min={0} max={LINKEDIN_UPKEEP_LIMITS.daily_check_limit.max}
              onChange={(n) => set({ daily_check_limit: n })} suffix="a day"
              hint="Each is one profile visit."
            />
            <NumberField
              label="Withdrawals" value={s.daily_withdraw_limit ?? LINKEDIN_UPKEEP_LIMITS.daily_withdraw_limit.default}
              min={0} max={LINKEDIN_UPKEEP_LIMITS.daily_withdraw_limit.max}
              onChange={(n) => set({ daily_withdraw_limit: n })} suffix="a day"
            />
            <NumberField
              label="Profiles enriched" value={s.daily_enrich_limit ?? LINKEDIN_UPKEEP_LIMITS.daily_enrich_limit.default}
              min={0} max={LINKEDIN_UPKEEP_LIMITS.daily_enrich_limit.max}
              onChange={(n) => set({ daily_enrich_limit: n })} suffix="a day"
              hint="Read from visits it makes anyway. 0 turns it off."
            />
          </div>
        ) : (
          <p className="text-caption text-[var(--text-tertiary)]">
            Needs migration <span className="font-mono">095_linkedin_autopilot.sql</span>.
          </p>
        )}
      </div>

      {dirty && (
        <div className="sticky bottom-3 flex items-center gap-2 panel px-4 py-2.5 shadow-[var(--shadow-lg)]">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
          <span className="text-body text-[var(--text-secondary)]">Unsaved changes</span>
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
    </>
  );
}

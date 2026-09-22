import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Target, Inbox, ShieldAlert, HelpCircle, Loader2, Plus, RefreshCw,
  CheckCircle2, AlertTriangle, Mail, ChevronRight, Info, Play,
} from 'lucide-react';
import { PageHeader } from '../../components/shared/PageHeader';
import { AsyncPanel } from '../../components/ui/AsyncPanel';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { Skeleton } from '../../components/ui/Skeleton';
import { placementApi, type PlacementDetail, type PlacementProbe, type PlacementSeed } from '../../api/placement.api';
import { smtpApi } from '../../api/smtp.api';
import { campaignsApi } from '../../api/campaigns.api';
import { cn } from '../../lib/utils';
import {
  placementByProvider, placementAdvice, PROVIDER_LABELS, MIN_SEEDS_FOR_RATE,
  type PlacementSummary, type ProbePlacement, type PlacementVerdict, formatDateTime } from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Where the mail actually landed.

   Everything else in this product serves deliverability and none of it
   could measure where mail ends up. This screen exists to answer one
   question and it is built so that it cannot answer it prematurely: the
   arithmetic lives in shared/placement, which refuses to produce a rate
   while a test is still running or when too few seeds answered.

   The design follows from that. A verdict, then the three counts that
   make it up, then the per-provider breakdown, then one line of advice
   that names what to change. No gauge, no score out of a hundred: this
   is six or eight observations, and a number with two decimal places
   over eight observations is a lie about precision.
   ═══════════════════════════════════════════════════════════════════════ */

const VERDICT: Record<PlacementVerdict, { label: string; tone: string; ring: string }> = {
  good:        { label: 'Reaching the inbox', tone: 'text-emerald-600 dark:text-emerald-400', ring: 'border-emerald-500/30 bg-emerald-500/8' },
  mixed:       { label: 'Mostly landing',     tone: 'text-amber-600 dark:text-amber-400',    ring: 'border-amber-500/30 bg-amber-500/8' },
  poor:        { label: 'Being filtered',     tone: 'text-rose-600 dark:text-rose-400',      ring: 'border-rose-500/30 bg-rose-500/8' },
  'too-early': { label: 'Still looking',      tone: 'text-[var(--text-secondary)]',          ring: 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60' },
  unknown:     { label: 'Nothing measured',   tone: 'text-[var(--text-secondary)]',          ring: 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60' },
};

const PLACEMENT_CHIP: Record<ProbePlacement, { label: string; className: string; icon: typeof Inbox }> = {
  inbox:   { label: 'Inbox',   className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', icon: Inbox },
  spam:    { label: 'Spam',    className: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',          icon: ShieldAlert },
  missing: { label: 'Missing', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',       icon: HelpCircle },
  pending: { label: 'Looking', className: 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]',      icon: Loader2 },
  error:   { label: 'Not sent', className: 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]',     icon: AlertTriangle },
};

/* ── The headline ─────────────────────────────────────────────────────── */

function Verdict({ summary }: { summary: PlacementSummary }) {
  const v = VERDICT[summary.verdict];
  return (
    <div className={cn('rounded-xl border px-4 py-3.5', v.ring)} data-placement-verdict>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={cn('text-heading font-semibold tracking-[-0.01em]', v.tone)}>{v.label}</span>
        {/*
          * The rate appears only when shared/placement is willing to
          * produce one - which is never while a probe is outstanding, and
          * never under four answering seeds. Two seeds in out of eight is
          * not "100% inbox", and showing it as one invites a launch.
          */}
        {summary.inboxRate !== null && (
          <span className="text-strong font-semibold tabular text-[var(--text-secondary)]">
            {Math.round(summary.inboxRate * 100)}% inbox
          </span>
        )}
      </div>
      <p className="mt-1 text-body leading-relaxed text-[var(--text-secondary)]">{summary.headline}</p>
    </div>
  );
}

function Counts({ summary }: { summary: PlacementSummary }) {
  const cells: Array<{ label: string; value: number; className: string; hint: string }> = [
    { label: 'Inbox', value: summary.inbox, className: 'text-emerald-600 dark:text-emerald-400', hint: 'Found in the inbox.' },
    { label: 'Spam', value: summary.spam, className: 'text-rose-600 dark:text-rose-400', hint: 'Found in the junk or spam folder.' },
    /*
     * Missing is its own column and never folded into spam. A message that
     * has not appeared may be greylisted, queued or blocked at the gateway
     * - filing it under spam would invent a filtering decision nobody saw.
     */
    { label: 'Missing', value: summary.missing, className: 'text-amber-600 dark:text-amber-400', hint: 'Never arrived. That is not the same as being filtered - it may have been rejected at the gateway or delayed.' },
  ];
  if (summary.pending > 0) {
    cells.push({ label: 'Looking', value: summary.pending, className: 'text-[var(--text-tertiary)]', hint: 'Still being searched for.' });
  }
  if (summary.errored > 0) {
    cells.push({ label: 'Not sent', value: summary.errored, className: 'text-[var(--text-tertiary)]', hint: 'The probe never left your mailbox, so it says nothing about the receiving provider. Left out of the arithmetic.' });
  }

  return (
    <div className="flex divide-x divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] overflow-hidden">
      {cells.map((c) => (
        <div key={c.label} className="flex-1 px-4 py-3" title={c.hint}>
          <div className={cn('text-title font-semibold tabular leading-none tracking-[-0.02em]', c.className)}>{c.value}</div>
          <div className="mt-1 text-caption font-medium text-[var(--text-tertiary)]">{c.label}</div>
        </div>
      ))}
    </div>
  );
}

function ProviderRow({ provider, summary }: { provider: string; summary: PlacementSummary }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span className="w-20 shrink-0 text-body font-medium text-[var(--text-primary)]">{provider}</span>

      {/* A bar of what actually happened, in the order it matters. */}
      <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
        {summary.inbox > 0 && <div className="bg-emerald-500" style={{ width: `${(summary.inbox / summary.total) * 100}%` }} />}
        {summary.spam > 0 && <div className="bg-rose-500" style={{ width: `${(summary.spam / summary.total) * 100}%` }} />}
        {summary.missing > 0 && <div className="bg-amber-500" style={{ width: `${(summary.missing / summary.total) * 100}%` }} />}
      </div>

      {/*
        * Counts, not a percentage. One provider is usually one or two
        * seeds, and "50%" over two observations reads as a measurement
        * when it is a coin flip.
        */}
      <span className="w-28 shrink-0 text-right text-caption tabular text-[var(--text-secondary)]">
        {summary.pending > 0
          ? `${summary.answered}/${summary.total} answered`
          : `${summary.inbox} of ${summary.answered} inbox`}
      </span>
    </div>
  );
}

function ProbeRow({ probe }: { probe: PlacementProbe }) {
  const chip = PLACEMENT_CHIP[probe.placement];
  const Icon = chip.icon;
  return (
    <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-2.5 last:border-0">
      <Mail className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
      <span className="min-w-0 flex-1 truncate text-body text-[var(--text-primary)]">{probe.seed_email}</span>

      {/*
        * The folder it was actually found in, so a surprising verdict can
        * be checked rather than taken on trust.
        */}
      {probe.folder && (
        <span className="hidden shrink-0 truncate text-caption text-[var(--text-tertiary)] sm:block max-w-[160px]" title={probe.folder}>
          {probe.folder}
        </span>
      )}
      {probe.send_error && (
        <span className="hidden shrink-0 truncate text-caption text-[var(--text-tertiary)] sm:block max-w-[220px]" title={probe.send_error}>
          {probe.send_error}
        </span>
      )}

      <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-micro font-semibold', chip.className)}>
        <Icon className={cn('h-3 w-3', probe.placement === 'pending' && 'animate-spin')} />
        {chip.label}
      </span>
    </div>
  );
}

/* ── One test, in full ────────────────────────────────────────────────── */

function TestDetail({ detail, onRefresh, refreshing }: {
  detail: PlacementDetail; onRefresh: () => void; refreshing: boolean;
}) {
  const groups = useMemo(() => placementByProvider(detail.results), [detail.results]);
  const advice = placementAdvice(detail.summary);
  const running = detail.test.status === 'sending' || detail.test.status === 'waiting';

  return (
    <div className="space-y-4">
      <Verdict summary={detail.summary} />
      <Counts summary={detail.summary} />

      {advice && (
        <div className="flex items-start gap-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 px-4 py-3">
          <Info className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--indigo)]" />
          <p className="text-body leading-relaxed text-[var(--text-secondary)]" data-placement-advice>{advice}</p>
        </div>
      )}

      {groups.length > 1 && (
        <section className="panel overflow-hidden">
          <div className="border-b border-[var(--border-subtle)] px-4 py-3">
            <h3 className="text-strong font-semibold text-[var(--text-primary)]">By provider</h3>
            <p className="mt-0.5 text-caption text-[var(--text-tertiary)]">
              Filtering is decided per provider, so one bad result here is a finding rather than an average.
            </p>
          </div>
          <div className="divide-y divide-[var(--border-subtle)]">
            {groups.map((g) => (
              <ProviderRow key={g.provider} provider={PROVIDER_LABELS[g.provider]} summary={g.summary} />
            ))}
          </div>
        </section>
      )}

      <section className="panel overflow-hidden">
        <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-strong font-semibold text-[var(--text-primary)]">{detail.test.subject}</h3>
            <p className="mt-0.5 text-caption text-[var(--text-tertiary)]">
              Sent {new Date(detail.test.started_at).toLocaleString()}
              {detail.test.completed_at ? ' · finished' : ''}
            </p>
          </div>
          {running && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="btn-secondary shrink-0 disabled:opacity-60"
              data-placement-refresh
            >
              <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
              {refreshing ? 'Looking…' : 'Look again'}
            </button>
          )}
        </div>
        <div>
          {detail.results.map((probe) => <ProbeRow key={probe.id} probe={probe} />)}
        </div>
      </section>
    </div>
  );
}

/* ── Starting one ─────────────────────────────────────────────────────── */

function StartTestModal({ open, onClose, seeds }: {
  open: boolean; onClose: () => void; seeds: PlacementSeed[];
}) {
  const queryClient = useQueryClient();
  const [senderId, setSenderId] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [stepId, setStepId] = useState('');
  const [subject, setSubject] = useState('');

  const { data: accounts } = useQuery({ queryKey: ['smtp-accounts'], queryFn: smtpApi.list });
  const { data: campaignPage } = useQuery({ queryKey: ['campaigns'], queryFn: () => campaignsApi.list() });
  // The endpoint paginates; the picker wants the rows.
  const campaigns = Array.isArray(campaignPage) ? campaignPage : (campaignPage?.data ?? []);

  // A seed is never a sender, so it is never offered as one.
  const senders = (accounts || []).filter((a: any) => !a.is_seed && a.is_active);

  const { data: steps } = useQuery({
    queryKey: ['campaign-steps', campaignId],
    queryFn: () => campaignsApi.getSteps(campaignId),
    enabled: !!campaignId,
  });
  const emailSteps = (steps || []).filter((s: any) => s.step_type === 'email' && s.subject);

  const start = useMutation({
    mutationFn: () => placementApi.start({
      smtp_account_id: senderId,
      campaign_id: campaignId || null,
      step_id: stepId || null,
      subject: stepId ? undefined : subject,
    }),
    onSuccess: (detail) => {
      queryClient.invalidateQueries({ queryKey: ['placement'] });
      toast.success('Probes sent. Results land as each provider delivers.');
      onClose();
      // Reset, so re-opening does not silently re-run the last test.
      setCampaignId(''); setStepId(''); setSubject('');
      void detail;
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Could not start the test'),
  });

  const readable = seeds.filter((s) => s.readable);
  const canStart = !!senderId && readable.length > 0 && (!!stepId || !!subject.trim());

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Run a placement test"
      description="One copy of a real message to each seed mailbox, then we read those mailboxes to see which folder it is in."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => start.mutate()} disabled={!canStart || start.isPending}>
            {start.isPending ? 'Sending…' : `Send to ${readable.length} seed${readable.length === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select
          label="Send from"
          options={[
            { value: '', label: 'Choose a mailbox…' },
            ...senders.map((a: any) => ({ value: a.id, label: `${a.email_address}${a.label ? ` — ${a.label}` : ''}` })),
          ]}
          value={senderId}
          onChange={(e) => setSenderId(e.target.value)}
          hint="The mailbox whose deliverability you want to know about."
        />

        {/*
          * Real copy by preference. A hand-typed probe measures a message
          * nobody will ever receive, and subject text is one of the
          * strongest signals a filter scores - so testing "test" tells you
          * about the word "test".
          */}
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 p-3.5">
          <p className="text-body font-semibold text-[var(--text-primary)]">What to send</p>
          <p className="mt-0.5 text-caption leading-snug text-[var(--text-tertiary)]">
            Use a real step wherever you can. Filters score the subject and the body, so a probe
            saying &ldquo;test&rdquo; tells you how deliverable the word test is.
          </p>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <Select
              label="Campaign"
              options={[
                { value: '', label: 'Not from a campaign' },
                ...(campaigns || []).map((c: any) => ({ value: c.id, label: c.name })),
              ]}
              value={campaignId}
              onChange={(e) => { setCampaignId(e.target.value); setStepId(''); }}
            />
            <Select
              label="Step"
              options={[
                { value: '', label: emailSteps.length ? 'Choose a step…' : 'No email steps' },
                ...emailSteps.map((s: any, i: number) => ({ value: s.id, label: `${i + 1}. ${s.subject}` })),
              ]}
              value={stepId}
              onChange={(e) => setStepId(e.target.value)}
              disabled={!campaignId || emailSteps.length === 0}
            />
          </div>

          {!stepId && (
            <div className="mt-3">
              <label className="mb-1 block text-body font-medium text-[var(--text-secondary)]">Subject line</label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="The subject you would actually send"
                className="block h-8 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-app)] px-2.5 text-strong text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--indigo)] focus:outline-none"
              />
            </div>
          )}
        </div>

        <p className="flex items-start gap-1.5 text-caption leading-relaxed text-[var(--text-tertiary)]">
          <Info className="mt-px h-3 w-3 shrink-0" />
          Nothing is added to the message — no code in the subject, no tracking pixel. The probe is
          identified by a header, so what gets scored is what you would actually send.
        </p>
      </div>
    </Modal>
  );
}

/* ── Seeds ────────────────────────────────────────────────────────────── */

function SeedPanel({ seeds }: { seeds: PlacementSeed[] }) {
  const queryClient = useQueryClient();
  const { data: accounts } = useQuery({ queryKey: ['smtp-accounts'], queryFn: smtpApi.list });

  const toggle = useMutation({
    mutationFn: ({ id, isSeed }: { id: string; isSeed: boolean }) => placementApi.setSeed(id, isSeed),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['placement', 'seeds'] });
      queryClient.invalidateQueries({ queryKey: ['smtp-accounts'] });
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Could not update that mailbox'),
  });

  const candidates = (accounts || []).filter((a: any) => !a.is_seed);
  const providers = new Set(seeds.map((s) => s.provider));
  const unreadable = seeds.filter((s) => !s.readable);

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-[var(--border-subtle)] px-4 py-3">
        <h3 className="text-strong font-semibold text-[var(--text-primary)]">Seed mailboxes</h3>
        <p className="mt-0.5 text-caption leading-snug text-[var(--text-tertiary)]">
          Mailboxes you control, at the providers your recipients use. They receive the probes and
          never send anything.
        </p>
      </div>

      {seeds.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <Target className="mx-auto mb-2 h-5 w-5 text-[var(--text-muted)]" strokeWidth={1.5} />
          <p className="text-body font-medium text-[var(--text-primary)]">No seed mailboxes yet</p>
          <p className="mx-auto mt-1 max-w-sm text-caption leading-relaxed text-[var(--text-tertiary)]">
            Connect a mailbox at Gmail, Outlook and Yahoo on the{' '}
            <Link to="/email-accounts" className="font-medium text-[var(--indigo)] hover:underline">email accounts</Link>{' '}
            page, then mark it as a seed below. Each one needs an incoming (IMAP) server so it can be read back.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[var(--border-subtle)]">
          {seeds.map((seed) => (
            <div key={seed.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="w-16 shrink-0 text-caption font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                {PROVIDER_LABELS[seed.provider]}
              </span>
              <span className="min-w-0 flex-1 truncate text-body text-[var(--text-primary)]">{seed.email_address}</span>

              {/*
                * A seed with no IMAP server can be sent to and never read,
                * which would sit pending until the test timed out and then
                * report "missing" - blaming a spam filter for a setting.
                * Said here rather than discovered there.
                */}
              {!seed.readable && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-[5px] bg-amber-500/10 px-1.5 py-0.5 text-micro font-semibold text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3" /> No IMAP — cannot be read
                </span>
              )}

              <button
                type="button"
                onClick={() => toggle.mutate({ id: seed.id, isSeed: false })}
                className="shrink-0 text-caption font-medium text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {/*
        * Coverage, stated plainly. A test against one Gmail seed is a test
        * of Gmail, and reading it as "our deliverability" is the mistake
        * this whole screen exists to prevent.
        */}
      {seeds.length > 0 && seeds.length < MIN_SEEDS_FOR_RATE && (
        <div className="flex items-start gap-2 border-t border-[var(--border-subtle)] px-4 py-2.5" data-seed-coverage>
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" />
          <p className="text-caption leading-relaxed text-[var(--text-secondary)]">
            {seeds.length} seed{seeds.length === 1 ? '' : 's'}, covering {providers.size} provider
            {providers.size === 1 ? '' : 's'}. Results will not be reported as a percentage under{' '}
            {MIN_SEEDS_FOR_RATE} — add one at each provider your recipients actually use.
          </p>
        </div>
      )}
      {unreadable.length > 0 && seeds.length >= MIN_SEEDS_FOR_RATE && (
        <div className="flex items-start gap-2 border-t border-[var(--border-subtle)] px-4 py-2.5">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" />
          <p className="text-caption leading-relaxed text-[var(--text-secondary)]">
            {unreadable.length} seed{unreadable.length === 1 ? '' : 's'} cannot be read back. Add an
            incoming (IMAP) server to {unreadable.length === 1 ? 'it' : 'them'} or they will be skipped.
          </p>
        </div>
      )}

      {candidates.length > 0 && (
        <div className="border-t border-[var(--border-subtle)] px-4 py-3">
          <p className="mb-2 text-caption font-medium text-[var(--text-tertiary)]">Make a connected mailbox a seed</p>
          <div className="flex flex-wrap gap-1.5">
            {candidates.map((a: any) => (
              <button
                key={a.id}
                type="button"
                onClick={() => toggle.mutate({ id: a.id, isSeed: true })}
                disabled={toggle.isPending}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-1 text-caption font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-60"
              >
                <Plus className="h-3 w-3" /> {a.email_address}
              </button>
            ))}
          </div>
          <p className="mt-2 text-caption leading-snug text-[var(--text-tertiary)]">
            A seed stops being available to send campaigns, and its sending history stops being
            clean, so use mailboxes kept for this.
          </p>
        </div>
      )}
    </section>
  );
}

/* ── The page ─────────────────────────────────────────────────────────── */

export function PlacementPage() {
  const queryClient = useQueryClient();
  const [showStart, setShowStart] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const seedsQuery = useQuery({
    queryKey: ['placement', 'seeds'],
    queryFn: placementApi.seeds,
  });
  const seeds = seedsQuery.data;

  const testsQuery = useQuery({
    queryKey: ['placement', 'tests'],
    queryFn: placementApi.list,
    // A running test resolves over minutes, so the list follows it without
    // anybody having to reload.
    refetchInterval: (q) =>
      (q.state.data || []).some((t) => t.status === 'sending' || t.status === 'waiting') ? 30_000 : false,
  });
  const tests = testsQuery.data;

  const currentId = openId || tests?.[0]?.id || null;

  const { data: detail } = useQuery({
    queryKey: ['placement', 'test', currentId],
    queryFn: () => placementApi.get(currentId!),
    enabled: !!currentId,
    refetchInterval: (q) => {
      const s = q.state.data?.test.status;
      return s === 'sending' || s === 'waiting' ? 20_000 : false;
    },
  });

  const refresh = useMutation({
    mutationFn: () => placementApi.refresh(currentId!),
    onSuccess: (next) => {
      queryClient.setQueryData(['placement', 'test', currentId], next);
      queryClient.invalidateQueries({ queryKey: ['placement', 'tests'] });
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Could not look again'),
  });

  const readableSeeds = (seeds || []).filter((s) => s.readable);

  return (
    <div className="stagger space-y-5 pb-8">
      <PageHeader
        className="!mx-0 !mt-0 rounded-xl border border-[var(--border-subtle)]"
        decorate
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[rgba(91,91,245,0.18)] bg-[var(--indigo-subtle)]">
            <Target className="h-4 w-4 text-[var(--indigo)]" />
          </span>
        }
        title="Inbox placement"
        description="Send a real message to mailboxes you control, then read them to find out which folder it landed in."
        meta={
          (seeds?.length || 0) > 0 ? (
            <span className="tabular">
              {seeds!.length} seed{seeds!.length === 1 ? '' : 's'} · {readableSeeds.length} readable
            </span>
          ) : undefined
        }
        actions={
          <Button
            variant="primary"
            onClick={() => setShowStart(true)}
            disabled={readableSeeds.length === 0}
            title={readableSeeds.length === 0 ? 'Add a seed mailbox with an IMAP server first' : undefined}
          >
            <Play className="h-3.5 w-3.5" /> Run a test
          </Button>
        }
      />

      {/*
        * What this can and cannot tell you, on the screen rather than in a
        * help article. A deliverability tool that overclaims is worse than
        * none, and every seed-testing product in this category is read as
        * more precise than it is.
        */}
      <div className="flex items-start gap-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 px-4 py-3">
        <Info className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
        <p className="text-caption leading-relaxed text-[var(--text-secondary)]" data-placement-caveat>
          Seed mailboxes have no history with you, never reply and never drag a message out of spam —
          real recipients do all three, so a real list usually does better than its seeds. Read this as a
          direction, not as a measurement of any individual recipient. Gmail&rsquo;s tabs are labels rather
          than folders and IMAP cannot reliably see them, so this reports inbox, spam and missing, and
          does not guess at Promotions.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <AsyncPanel
            query={testsQuery}
            skeleton="panel"
            empty={{
              icon: Target,
              title: 'Nothing measured yet',
              description: readableSeeds.length === 0
                ? 'Your domain records, warm-up and bounce guard all exist to get mail into the inbox, and this is the only thing that can tell you whether they are working. Add a seed mailbox first \u2014 one you control at each provider your recipients use.'
                : 'Your domain records, warm-up and bounce guard all exist to get mail into the inbox. This is the only thing here that can tell you whether they are working.',
            }}
          >
            {() => detail ? (
              <TestDetail
                detail={detail}
                onRefresh={() => refresh.mutate()}
                refreshing={refresh.isPending}
              />
            ) : (
              /* The list has arrived but the chosen test has not yet. Same
                 placeholder shape, so the panel does not change size twice. */
              <Skeleton className="h-48 rounded-xl" />
            )}
          </AsyncPanel>

          {(tests?.length || 0) > 1 && (
            <section className="panel overflow-hidden">
              <div className="border-b border-[var(--border-subtle)] px-4 py-3">
                <h3 className="text-strong font-semibold text-[var(--text-primary)]">Earlier tests</h3>
                <p className="mt-0.5 text-caption text-[var(--text-tertiary)]">
                  Placement moves with your volume, your records and your copy. The trend is the point.
                </p>
              </div>
              <div className="divide-y divide-[var(--border-subtle)]">
                {tests!.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setOpenId(t.id)}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--bg-hover)]',
                      t.id === currentId && 'bg-[var(--bg-elevated)]/60',
                    )}
                  >
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full',
                      t.summary.verdict === 'good' ? 'bg-emerald-500'
                        : t.summary.verdict === 'mixed' ? 'bg-amber-500'
                        : t.summary.verdict === 'poor' ? 'bg-rose-500'
                        : 'bg-[var(--text-muted)]')} />
                    <span className="min-w-0 flex-1 truncate text-body text-[var(--text-primary)]">{t.subject}</span>
                    <span className="hidden shrink-0 text-caption text-[var(--text-tertiary)] sm:block">
                      {formatDateTime(new Date(t.started_at))}
                    </span>
                    <span className="w-24 shrink-0 text-right text-caption tabular text-[var(--text-secondary)]">
                      {t.summary.inboxRate !== null
                        ? `${Math.round(t.summary.inboxRate * 100)}% inbox`
                        : t.summary.pending > 0 ? 'Looking…' : '—'}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <AsyncPanel query={seedsQuery} skeleton="panel">
            {(rows) => <SeedPanel seeds={rows} />}
          </AsyncPanel>

          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 px-4 py-3">
            <p className="flex items-center gap-1.5 text-body font-semibold text-[var(--text-primary)]">
              <CheckCircle2 className="h-3.5 w-3.5 text-[var(--indigo)]" />
              Before you blame the copy
            </p>
            <p className="mt-1 text-caption leading-relaxed text-[var(--text-secondary)]">
              Authentication moves placement more than wording does.{' '}
              <Link to="/domains" className="font-medium text-[var(--indigo)] hover:underline">Check SPF, DKIM and DMARC</Link>{' '}
              are all passing before rewriting anything.
            </p>
          </div>
        </div>
      </div>

      <StartTestModal open={showStart} onClose={() => setShowStart(false)} seeds={seeds || []} />
    </div>
  );
}

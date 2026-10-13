import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Zap, Globe, Plus, X, Sparkles, Send, ListPlus, ExternalLink, Loader2, Eye, Clock3, Undo2, Building2, Handshake, UserMinus, Users, Check,
} from 'lucide-react';
import { SIGNAL_KIND_LABELS, type Signal, type SignalKind, type SignalPerson, type SignalTopic } from '@lemlist/shared';
import { signalsApi, type MomentsResponse } from '../../api/signals.api';
import { PageHeader } from '../../components/shared/PageHeader';
import { PageSkeleton } from '../../components/ui/Skeleton';
import { Button } from '../../components/ui/Button';
import { Toggle } from '../../components/ui/Toggle';
import { useDeferredAction } from '../../components/ui/UndoBar';
import { formatRelativeTime } from '../../lib/utils';
import { MomentWriteDialog, MomentAddDialog } from '../../components/moments/MomentDialogs';

/* ═══════════════════════════════════════════════════════════════════════
   Moments: who to email today, and why.

   Each card is one change worth writing about - with its evidence, the
   person to write to, and one click to act: an email that opens with it,
   or the person added to a campaign with it as their first line.
   ═══════════════════════════════════════════════════════════════════════ */

const KIND_ICON: Record<SignalKind, typeof Zap> = {
  re_engaged: Eye,
  not_now_due: Clock3,
  lost_deal_return: Handshake,
  company_buzz: Users,
  stalled_positive: Undo2,
  left_company: UserMinus,
  web_change: Globe,
};

const STRENGTH: Record<number, { label: string; cls: string }> = {
  3: { label: 'Strong', cls: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400' },
  2: { label: 'Good', cls: 'bg-[var(--indigo)]/10 text-[var(--indigo)]' },
  1: { label: 'Worth a look', cls: 'bg-[var(--bg-app)] text-[var(--text-tertiary)]' },
};

const who = (p: SignalPerson) => p.name || p.email;

export function MomentsPage() {
  const qc = useQueryClient();
  const defer = useDeferredAction();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [writing, setWriting] = useState<{ moment: Signal; to: SignalPerson } | null>(null);
  const [adding, setAdding] = useState<{ moment: Signal; to: SignalPerson } | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['moments'], queryFn: signalsApi.list, staleTime: 60_000 });
  const moments = useMemo(() => (data?.moments || []).filter((m) => !hidden.has(m.id)), [data, hidden]);

  const finish = (id: string) => {
    setHidden((h) => new Set(h).add(id));
    qc.invalidateQueries({ queryKey: ['moments', 'count'] });
  };

  const dismiss = (m: Signal) => {
    setHidden((h) => new Set(h).add(m.id));
    defer({
      id: `moment:${m.id}`,
      label: 'Moment dismissed',
      commit: async () => { await signalsApi.dismiss(m.id); qc.invalidateQueries({ queryKey: ['moments', 'count'] }); },
      revert: () => setHidden((h) => { const n = new Set(h); n.delete(m.id); return n; }),
    });
  };

  return (
    <>
      <PageHeader
        icon={Zap}
        title="Moments"
        description="People and companies where something just changed, so your email lands at the right time."
      />
      <div className="space-y-4" data-moments>
        {isLoading ? (
          <PageSkeleton variant="panels" bleed={false} />
        ) : isError || !data ? (
          <div className="flex items-center gap-3 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3.5 text-body text-rose-700 dark:text-rose-400">
            <span className="flex-1">Moments could not be loaded just now.</span>
            <Button size="sm" variant="secondary" onClick={() => refetch()}>Try again</Button>
          </div>
        ) : !data.settings.ready ? (
          <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3.5 text-body text-amber-800 dark:text-amber-300" data-moments-migration>
            Moments need database migration 083 before they can be saved. Once it has run, this page fills in on its own.
          </div>
        ) : (
          <>
            <WatchSettings data={data} />
            {moments.length === 0 ? (
              <EmptyState webOn={data.settings.web} />
            ) : (
              <div className="space-y-3">
                {moments.map((m) => (
                  <MomentCard
                    key={m.id}
                    moment={m}
                    onWrite={(to) => setWriting({ moment: m, to })}
                    onAdd={(to) => setAdding({ moment: m, to })}
                    onDismiss={() => dismiss(m)}
                  />
                ))}
              </div>
            )}
            {data.acted_this_week > 0 && (
              <p className="text-caption text-[var(--text-tertiary)]">{data.acted_this_week} acted on in the last 7 days.</p>
            )}
          </>
        )}
      </div>

      {writing && (
        <MomentWriteDialog
          moment={writing.moment}
          to={writing.to}
          onClose={() => setWriting(null)}
          onSent={() => { finish(writing.moment.id); setWriting(null); }}
        />
      )}
      {adding && (
        <MomentAddDialog
          moment={adding.moment}
          to={adding.to}
          onClose={() => setAdding(null)}
          onAdded={() => { finish(adding.moment.id); setAdding(null); }}
        />
      )}
    </>
  );
}

/* ── One moment ────────────────────────────────────────────────────── */

function MomentCard({ moment: m, onWrite, onAdd, onDismiss }: {
  moment: Signal;
  onWrite: (to: SignalPerson) => void;
  onAdd: (to: SignalPerson) => void;
  onDismiss: () => void;
}) {
  const options = m.contact ? [m.contact] : m.people;
  const [pick, setPick] = useState<string | null>(options[0]?.id ?? null);
  const to = options.find((p) => p.id === pick) || null;
  const Icon = KIND_ICON[m.kind] || Zap;
  const strength = STRENGTH[m.strength] || STRENGTH[2];

  return (
    <article className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4" data-moment={m.kind}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--indigo)]/10 text-[var(--indigo)]">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-[var(--text-tertiary)]">
            <span className="font-semibold uppercase tracking-wide">{SIGNAL_KIND_LABELS[m.kind]}</span>
            <span className={`rounded-full px-2 py-0.5 font-medium ${strength.cls}`}>{strength.label}</span>
            <span>{formatRelativeTime(m.occurred_at)}</span>
            {m.company && (
              <Link to={`/companies/${m.company.id}`} className="inline-flex items-center gap-1 font-medium text-[var(--text-secondary)] hover:text-[var(--indigo)] hover:underline">
                <Building2 className="h-3 w-3" /> {m.company.name}
              </Link>
            )}
          </div>
          <p className="text-strong font-semibold text-[var(--text-primary)]">{m.headline}</p>
          {m.detail && <p className="mt-1 text-body text-[var(--text-secondary)]">{m.detail}</p>}
          {m.evidence_quote && (
            <blockquote className="mt-2 border-l-2 border-[var(--border-default)] pl-3 text-body italic text-[var(--text-secondary)]">
              "{m.evidence_quote}"
              {m.evidence_url && (
                <a href={m.evidence_url} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-1 not-italic text-caption font-medium text-[var(--indigo)] hover:underline">
                  Source <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </blockquote>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {options.length > 0 ? (
              <>
                <span className="text-caption text-[var(--text-tertiary)]">Write to</span>
                {options.length === 1 ? (
                  <Link to={`/contacts/${options[0].id}`} className="text-body font-medium text-[var(--text-primary)] hover:underline">
                    {who(options[0])}{options[0].title ? <span className="font-normal text-[var(--text-tertiary)]"> · {options[0].title}</span> : null}
                  </Link>
                ) : (
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Who to write to">
                    {options.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        role="radio"
                        aria-checked={p.id === pick}
                        onClick={() => setPick(p.id)}
                        className={`rounded-full border px-2.5 py-1 text-caption font-medium transition-colors ${p.id === pick ? 'border-[var(--indigo)] bg-[var(--indigo)]/10 text-[var(--indigo)]' : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                      >
                        {who(p)}{p.title ? ` · ${p.title}` : ''}
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : m.company ? (
              <span className="inline-flex items-center gap-1.5 text-body text-[var(--text-secondary)]">
                <Building2 className="h-3.5 w-3.5" /> No one at {m.company.name} to write to yet.
                <Link to="/prospector" className="font-medium text-[var(--indigo)] hover:underline">Find people</Link>
              </span>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {to && (
              <>
                <Button size="sm" onClick={() => onWrite(to)}><Send className="h-3.5 w-3.5" /> Write email</Button>
                <Button size="sm" variant="secondary" onClick={() => onAdd(to)}><ListPlus className="h-3.5 w-3.5" /> Add to campaign</Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={onDismiss}><X className="h-3.5 w-3.5" /> Not relevant</Button>
          </div>
        </div>
      </div>
    </article>
  );
}

function EmptyState({ webOn }: { webOn: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--border-default)] px-5 py-8 text-center" data-moments-empty>
      <Zap className="mx-auto mb-2 h-6 w-6 text-[var(--text-tertiary)]" />
      <p className="text-strong font-semibold text-[var(--text-primary)]">Nothing needs you right now</p>
      <p className="mx-auto mt-1 max-w-xl text-body text-[var(--text-secondary)]">
        Moments appear when someone comes back to your emails, a "not now" comes due, a lost deal turns three months old, or a yes goes quiet.
        {webOn ? ' Changes on the websites you watch show up here too.' : ' Switch on website watching above to catch hiring, launches and new markets as well.'}
      </p>
    </div>
  );
}

/* ── Website watching ──────────────────────────────────────────────── */

function WatchSettings({ data }: { data: MomentsResponse }) {
  const qc = useQueryClient();
  const s = data.settings;
  const [adding, setAdding] = useState('');

  const save = useMutation({
    mutationFn: signalsApi.configure,
    onSuccess: (settings) => qc.setQueryData<MomentsResponse>(['moments'], (old) => (old ? { ...old, settings } : old)),
    onError: (err: any) => toast.error(err?.response?.data?.error || 'That could not be saved.'),
  });
  const suggest = useMutation({
    mutationFn: signalsApi.suggest,
    onSuccess: (r) => {
      const have = new Set(s.topics.map((t) => t.label.toLowerCase()));
      const merged: SignalTopic[] = [...s.topics, ...r.topics.filter((t) => !have.has(t.toLowerCase())).map((label) => ({ label, on: true }))];
      save.mutate({ topics: merged });
      if (r.engine === 'default') toast('Add what you sell in Settings for suggestions that fit your business.');
    },
    onError: () => toast.error('Suggestions are not available just now.'),
  });

  // Switching it on with nothing to watch for: suggest straight away.
  const setWeb = (on: boolean) => {
    save.mutate({ web: on });
    if (on && s.topics.length === 0) suggest.mutate();
  };
  const setTopics = (topics: SignalTopic[]) => save.mutate({ topics });
  const add = () => {
    const label = adding.trim();
    if (label.length < 3) return;
    setTopics([...s.topics, { label, on: true }]);
    setAdding('');
  };

  return (
    <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]" data-moments-watch>
      <div className="flex items-start gap-3 px-4 py-3.5">
        <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--indigo)]/10 text-[var(--indigo)]"><Globe className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-strong font-semibold text-[var(--text-primary)]">Watch company websites</p>
          <p className="text-caption text-[var(--text-tertiary)]">
            Relay reads the home, careers and news pages of companies you have people at, once a week, and tells you when something you care about changes.
            {s.web && s.watching > 0 ? ` Watching ${s.watching} ${s.watching === 1 ? 'company' : 'companies'}${s.last_checked ? `, last checked ${formatRelativeTime(s.last_checked)}` : ''}.` : ''}
          </p>
          {!s.ai && <p className="mt-1 text-caption text-amber-700 dark:text-amber-400">Needs Claude to judge what changed. Your own-data moments work without it.</p>}
        </div>
        <Toggle checked={s.web} onChange={setWeb} disabled={!s.ai || save.isPending} aria-label="Watch company websites" />
      </div>
      {s.web && (
        <div className="border-t border-[var(--border-subtle)] px-4 py-3.5">
          <p className="mb-2 text-caption font-medium text-[var(--text-secondary)]">Tell me when a company is…</p>
          <div className="flex flex-wrap gap-1.5">
            {s.topics.map((t, i) => (
              <span key={t.label} className={`inline-flex items-center gap-1 rounded-full border text-caption font-medium ${t.on ? 'border-[var(--indigo)]/40 bg-[var(--indigo)]/8 text-[var(--text-primary)]' : 'border-[var(--border-subtle)] text-[var(--text-tertiary)] line-through'}`}>
                <button type="button" className="py-1 pl-2.5" onClick={() => setTopics(s.topics.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))} aria-pressed={t.on}>
                  {t.on && <Check className="mr-1 inline h-3 w-3" />}{t.label}
                </button>
                <button type="button" className="py-1 pr-2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]" onClick={() => setTopics(s.topics.filter((_, j) => j !== i))} aria-label={`Remove ${t.label}`}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {suggest.isPending && <span className="inline-flex items-center gap-1 px-2 py-1 text-caption text-[var(--text-tertiary)]"><Loader2 className="h-3 w-3 animate-spin" /> Thinking about what you sell…</span>}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <form className="flex min-w-[14rem] flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
              <input
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                maxLength={80}
                placeholder="Add your own, e.g. Opening a new warehouse"
                className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 text-body text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--indigo)]"
              />
              <Button size="sm" variant="secondary" type="submit" disabled={adding.trim().length < 3}><Plus className="h-3.5 w-3.5" /> Add</Button>
            </form>
            <Button size="sm" variant="ghost" onClick={() => suggest.mutate()} disabled={suggest.isPending}><Sparkles className="h-3.5 w-3.5" /> Suggest from what I sell</Button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ── Acting on one ─────────────────────────────────────────────────── */

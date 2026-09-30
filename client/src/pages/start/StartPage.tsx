import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import Papa from 'papaparse';
import toast from 'react-hot-toast';
import {
  Rocket, Check, Mail, Globe, Users, Sparkles, Send, Loader2, Copy, RefreshCw, Upload,
  ArrowRight, ChevronRight, Inbox, PenLine,
} from 'lucide-react';
import {
  emailDomain, isFreeMailDomain, planImport, prepareImport,
  type DnsRecordInstruction, type SendingDomain, type SmtpAccount,
} from '@lemlist/shared';
import { PageHeader } from '../../components/shared/PageHeader';
import { Button } from '../../components/ui/Button';
import { smtpApi } from '../../api/smtp.api';
import { domainApi } from '../../api/domain.api';
import { contactsApi, listsApi } from '../../api/contacts.api';
import { setupApi } from '../../api/setup.api';
import { cn } from '../../lib/utils';

const SmtpAccountModal = lazy(() =>
  import('../smtp/SmtpAccountModal').then((m) => ({ default: m.SmtpAccountModal })));

/* ═══════════════════════════════════════════════════════════════════════
   From first login to first reply, on one page.

   Every piece of getting a first campaign out already existed - the connect
   wizard, the DNS records, the importer, Relay writing the sequence, the
   launch check - on five different pages, each of which assumed you knew
   to go to it and in which order. This walks them in order and does the
   first three right here: a mailbox connected in a dialog over this page,
   the DNS records shown to copy with a "check again" beside them, a CSV
   dropped straight onto the step. The last two hand over to the builder
   with the list and Relay already set up, because that is where writing
   and launching already work well.

   Each step reads its state from the account, not from a "done" flag, so
   doing something elsewhere ticks it here too, and nothing here can say a
   step is done that is not.
   ═══════════════════════════════════════════════════════════════════════ */

const LIST_KEY = 'start:list';

type StepId = 'mailbox' | 'domain' | 'leads' | 'sequence' | 'launch';

function readList(): string | null {
  try { return localStorage.getItem(LIST_KEY); } catch { return null; }
}
function writeList(id: string | null) {
  try { if (id) localStorage.setItem(LIST_KEY, id); else localStorage.removeItem(LIST_KEY); } catch { /* private mode */ }
}

export function StartPage() {
  const { data: setup } = useQuery({ queryKey: ['setup-state'], queryFn: setupApi.get, staleTime: 0, refetchOnWindowFocus: true });
  const { data: accounts = [] } = useQuery({ queryKey: ['smtp-accounts'], queryFn: smtpApi.list });
  const { data: domains = [] } = useQuery({ queryKey: ['domains'], queryFn: domainApi.list });
  const { data: lists = [] } = useQuery({ queryKey: ['lists', 'lead'], queryFn: () => listsApi.list('lead') });
  const [listId, setListId] = useState<string | null>(readList);
  const [skipDomain, setSkipDomain] = useState(false);

  const mailboxes = (accounts as SmtpAccount[]).filter((a) => a.is_active && !(a as any).is_seed);
  const ready = mailboxes.filter((a) => a.is_verified);

  const sendingDomains = useMemo(() => [...new Set(ready.map((a) => emailDomain(a.email_address)).filter(Boolean) as string[])], [ready]);
  const ownDomains = sendingDomains.filter((d) => !isFreeMailDomain(d));
  const domainRow = (d: string) => (domains as SendingDomain[]).find((x) => x.domain.toLowerCase() === d);
  const domainOk = (d: string) => { const r = domainRow(d); return !!r && r.is_verified && !!r.spf_ok && !!r.dkim_ok; };

  const chosen = (lists as any[]).find((l) => l.id === listId && (l.contact_count || 0) > 0)
    || (!listId ? (lists as any[]).find((l) => (l.contact_count || 0) > 0) : null);
  const stepDone = (id: string) => !!setup?.steps.find((s) => s.id === id)?.done;

  const done: Record<StepId, boolean> = {
    mailbox: ready.length > 0,
    // The account's own setup check has the last word, so this page and the
    // checklist on Home can never disagree about a step.
    domain: stepDone('domain') || (ready.length > 0 && (skipDomain || ownDomains.every(domainOk))),
    leads: !!chosen || (stepDone('contacts') && stepDone('sequence')),
    sequence: stepDone('sequence'),
    launch: stepDone('launch'),
  };
  const order: StepId[] = ['mailbox', 'domain', 'leads', 'sequence', 'launch'];
  const current = order.find((id) => !done[id]) ?? null;
  const [open, setOpen] = useState<StepId | null>(null);
  const active = open ?? current;
  const count = order.filter((id) => done[id]).length;

  const step = (id: StepId, n: number, title: string, summary: string, icon: React.ElementType, body: React.ReactNode) => (
    <StepCard
      key={id}
      n={n} title={title} summary={summary} icon={icon}
      done={done[id]} current={current === id} expanded={active === id}
      locked={order.indexOf(id) > order.indexOf(current ?? 'launch') && !done[id]}
      onToggle={() => setOpen(active === id ? null : id)}
    >
      {body}
    </StepCard>
  );

  return (
    <>
      <PageHeader
        icon={Rocket}
        title={current ? 'Get your first campaign out' : 'You are live'}
        description={current
          ? 'Five steps, in the order they depend on each other. Most take a minute, and none needs doing twice.'
          : 'Your first campaign is sending. Replies land in your inbox, and Relay sorts them as they arrive.'}
        meta={<span className="tabular">{count} of 5 done</span>}
        contentClassName="max-w-3xl"
      />
      <div className="max-w-3xl space-y-3" data-start>
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
          <div className="h-full rounded-full bg-[var(--indigo)] transition-[width] duration-500" style={{ width: `${(count / 5) * 100}%` }} />
        </div>

        {step('mailbox', 1, 'Connect the mailbox you send from',
          ready.length ? `${ready.map((a) => a.email_address).join(', ')}` : 'Tested before it is saved - two minutes.',
          Mail, <MailboxStep mailboxes={mailboxes} />)}

        {step('domain', 2, 'Prove the mail is really from you',
          ownDomains.length === 0 && ready.length ? 'A Gmail or Outlook address is authenticated by its provider.'
            : ownDomains.length ? `${ownDomains.filter(domainOk).length} of ${ownDomains.length} domain${ownDomains.length === 1 ? '' : 's'} authenticated` : 'SPF and DKIM, so Gmail and Outlook trust it.',
          Globe, <DomainStep domains={ownDomains} row={domainRow} ok={domainOk} consumer={sendingDomains.filter(isFreeMailDomain)} onSkip={() => setSkipDomain(true)} />)}

        {step('leads', 3, 'Add the people to reach',
          chosen ? `${chosen.name} - ${(chosen.contact_count || 0).toLocaleString()} people` : 'Drop a CSV - the columns are worked out for you.',
          Users, <LeadsStep lists={lists as any[]} chosenId={chosen?.id ?? null} onChoose={(id) => { setListId(id); writeList(id); setOpen(null); }} />)}

        {step('sequence', 4, 'Let Relay write the emails',
          done.sequence ? 'Written.' : 'A short sequence from what you sell and who they are - yours to edit.',
          Sparkles, <SequenceStep listId={chosen?.id ?? null} />)}

        {step('launch', 5, 'Check and launch',
          done.launch ? 'Your first campaign is out.' : 'The launch check fixes what it can in place.',
          Send, <LaunchStep launched={done.launch} />)}
      </div>
    </>
  );
}

function StepCard({ n, title, summary, icon: Icon, done, current, expanded, locked, onToggle, children }: {
  n: number; title: string; summary: string; icon: React.ElementType;
  done: boolean; current: boolean; expanded: boolean; locked: boolean;
  onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        'overflow-hidden rounded-2xl border bg-[var(--bg-surface)] transition-shadow',
        current ? 'border-[var(--indigo)]/40 shadow-[var(--shadow-md)]' : 'border-[var(--border-subtle)]',
        locked && 'opacity-60',
      )}
      data-start-step={n}
      data-state={done ? 'done' : current ? 'current' : 'todo'}
    >
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
        <span className={cn(
          'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-body font-semibold',
          done ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
            : current ? 'bg-[var(--indigo)] text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]',
        )}>
          {done ? <Check className="h-4 w-4" strokeWidth={3} /> : n}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-strong font-semibold text-[var(--text-primary)]">
            <Icon className="h-4 w-4 text-[var(--text-tertiary)]" /> {title}
          </span>
          <span className="mt-0.5 block truncate text-caption text-[var(--text-tertiary)]">{summary}</span>
        </span>
        <ChevronRight className={cn('h-4 w-4 flex-shrink-0 text-[var(--text-muted)] transition-transform', expanded && 'rotate-90')} />
      </button>
      {expanded && <div className="border-t border-[var(--border-subtle)] px-4 py-4">{children}</div>}
    </section>
  );
}

/* ── 1. Mailbox ──────────────────────────────────────────────────────── */

function MailboxStep({ mailboxes }: { mailboxes: SmtpAccount[] }) {
  const qc = useQueryClient();
  const [connecting, setConnecting] = useState(false);
  return (
    <div className="space-y-3">
      {mailboxes.length > 0 && (
        <ul className="space-y-1.5">
          {mailboxes.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-body">
              <span className={cn('h-2 w-2 rounded-full', a.is_verified ? 'bg-emerald-500' : 'bg-amber-500')} />
              <span className="text-[var(--text-primary)]">{a.email_address}</span>
              <span className="text-caption text-[var(--text-tertiary)]">{a.is_verified ? 'ready to send' : 'not passing its test yet'}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-body text-[var(--text-secondary)]">
        Pick your provider and add an app password. Sincerely signs in, sends itself a test and reads the inbox before anything is saved, so a mailbox that shows here works.
      </p>
      <Button onClick={() => setConnecting(true)}>
        <Mail className="h-4 w-4" /> {mailboxes.length ? 'Connect another mailbox' : 'Connect a mailbox'}
      </Button>
      {connecting && (
        <Suspense fallback={null}>
          <SmtpAccountModal
            open
            onClose={() => { setConnecting(false); qc.invalidateQueries({ queryKey: ['smtp-accounts'] }); qc.invalidateQueries({ queryKey: ['setup-state'] }); }}
            onConnected={() => { qc.invalidateQueries({ queryKey: ['smtp-accounts'] }); qc.invalidateQueries({ queryKey: ['setup-state'] }); }}
          />
        </Suspense>
      )}
    </div>
  );
}

/* ── 2. Domain ───────────────────────────────────────────────────────── */

function DomainStep({ domains, row, ok, consumer, onSkip }: {
  domains: string[];
  row: (d: string) => SendingDomain | undefined;
  ok: (d: string) => boolean;
  consumer: string[];
  onSkip: () => void;
}) {
  if (domains.length === 0) {
    return (
      <p className="text-body text-[var(--text-secondary)]">
        {consumer.length
          ? `${consumer.join(', ')} is authenticated by its provider, so there is nothing to set up. A domain you own will do better for cold email - add one any time under Email accounts.`
          : 'Connect a mailbox first - this step is about the domain it sends from.'}
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-body text-[var(--text-secondary)]">
        Add these records where your domain's DNS is managed (your registrar or host), then check. Changes usually show within minutes, sometimes an hour.
      </p>
      {domains.map((d) => <DomainRecords key={d} domain={d} row={row(d)} ok={ok(d)} />)}
      <button type="button" onClick={onSkip} className="text-caption font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:underline">
        Skip for now - I will do this later
      </button>
    </div>
  );
}

function DomainRecords({ domain, row, ok }: { domain: string; row?: SendingDomain; ok: boolean }) {
  const qc = useQueryClient();
  const [records, setRecords] = useState<DnsRecordInstruction[] | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['domains'] }); qc.invalidateQueries({ queryKey: ['setup-state'] }); };

  const add = useMutation({
    mutationFn: () => domainApi.create(domain),
    onSuccess: (r) => { setRecords(r.records); refresh(); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not add the domain'),
  });
  const load = useMutation({
    mutationFn: () => domainApi.getRecords(row!.id),
    onSuccess: (r) => setRecords(r.records),
  });
  const check = useMutation({
    mutationFn: () => domainApi.verify(row!.id),
    onSuccess: (r) => {
      setRecords(r.records);
      refresh();
      const missing = r.records.filter((x) => x.status !== 'verified').length;
      if (missing === 0) toast.success(`${domain} is authenticated`);
      else toast(`${missing} record${missing === 1 ? '' : 's'} not found yet - DNS can take a little while`, { icon: '⏳' });
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not check DNS just now'),
  });

  // Show the records straight away for a domain already added.
  const loaded = useRef(false);
  useEffect(() => {
    if (row && !ok && !loaded.current) { loaded.current = true; load.mutate(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id, ok]);

  return (
    <div className="rounded-xl border border-[var(--border-subtle)]" data-start-domain={domain}>
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <Globe className="h-4 w-4 text-[var(--text-tertiary)]" />
        <span className="flex-1 text-body font-medium text-[var(--text-primary)]">{domain}</span>
        {ok ? (
          <span className="inline-flex items-center gap-1 text-caption font-semibold text-emerald-600 dark:text-emerald-400"><Check className="h-3.5 w-3.5" strokeWidth={3} /> Authenticated</span>
        ) : row ? (
          <Button size="sm" variant="secondary" onClick={() => check.mutate()} disabled={check.isPending}>
            {check.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Check again
          </Button>
        ) : (
          <Button size="sm" onClick={() => add.mutate()} disabled={add.isPending}>
            {add.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Show the records
          </Button>
        )}
      </div>
      {!ok && records && records.length > 0 && (
        <ul className="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">
          {records.map((r, i) => (
            <li key={`${r.type}-${r.host}-${i}`} className="grid grid-cols-[auto,1fr] items-start gap-x-3 gap-y-1 px-3.5 py-2.5 sm:grid-cols-[4.5rem,auto,1fr,auto]">
              <span className={cn('text-caption font-semibold', r.status === 'verified' ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--text-secondary)]')}>
                {r.label || r.type}
              </span>
              <span className="font-mono text-caption text-[var(--text-tertiary)]">{r.type}</span>
              <CopyField label="Host" value={r.host} />
              {r.value ? <CopyField label="Value" value={r.value} /> : <span className="text-caption text-[var(--text-tertiary)]">{r.note || 'Nothing to add'}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const copy = () => {
    navigator.clipboard?.writeText(value).then(() => toast.success(`${label} copied`)).catch(() => toast.error('Could not copy'));
  };
  return (
    <button type="button" onClick={copy} title={`Copy ${label.toLowerCase()}`} className="group col-span-2 flex min-w-0 items-center gap-1.5 rounded-md bg-[var(--bg-elevated)] px-2 py-1 text-left sm:col-span-1">
      <span className="truncate font-mono text-caption text-[var(--text-primary)]">{value}</span>
      <Copy className="h-3 w-3 flex-shrink-0 text-[var(--text-muted)] group-hover:text-[var(--indigo)]" />
    </button>
  );
}

/* ── 3. Leads ────────────────────────────────────────────────────────── */

function LeadsStep({ lists, chosenId, onChoose }: {
  lists: Array<{ id: string; name: string; contact_count?: number }>;
  chosenId: string | null;
  onChoose: (id: string) => void;
}) {
  const withPeople = lists.filter((l) => (l.contact_count || 0) > 0);
  return (
    <div className="space-y-4">
      <QuickImport onImported={onChoose} />
      {withPeople.length > 0 && (
        <div>
          <p className="mb-1.5 text-caption font-medium text-[var(--text-tertiary)]">Or use a list you already have</p>
          <div className="flex flex-wrap gap-2">
            {withPeople.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => onChoose(l.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border px-2.5 h-8 text-body',
                  chosenId === l.id ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)] text-[var(--indigo)]' : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
                )}
              >
                {chosenId === l.id && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                {l.name} <span className="text-caption tabular opacity-70">{(l.contact_count || 0).toLocaleString()}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The importer for the common case, in place: drop a file, and if its
 * email column is certain it goes straight in as a new list named after
 * the file. A doubtful file goes to the full importer, which asks.
 */
function QuickImport({ onImported }: { onImported: (listId: string) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const run = useCallback((file: File) => {
    setNote(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim().replace(/^﻿/, ''),
      complete: async (result) => {
        const rows = (result.data || []).filter((r) => r && Object.values(r).some((v) => v && String(v).trim()));
        const headers = (result.meta.fields || []).map((h) => h.trim());
        if (!rows.length || !headers.length) { setNote('That file has no rows to import.'); return; }
        const plan = planImport(headers, rows);
        if (!plan.confident) {
          toast('Let\'s check the columns on this one', { icon: '🧭' });
          navigate('/contacts/import');
          return;
        }
        const prepared = prepareImport(rows, plan.mapping);
        if (!prepared.contacts.length) { setNote('None of those rows has a usable email address.'); return; }
        try {
          const name = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'First import';
          const list = await listsApi.create({ name: name.charAt(0).toUpperCase() + name.slice(1), kind: 'lead' } as any);
          const total = prepared.contacts.length;
          setProgress({ done: 0, total });
          let imported = 0;
          for (let i = 0; i < total; i += 100) {
            const r = await contactsApi.bulkCreate(prepared.contacts.slice(i, i + 100) as any, list.id, file.name);
            imported += r.imported;
            setProgress({ done: Math.min(i + 100, total), total });
          }
          qc.invalidateQueries({ queryKey: ['lists'] });
          qc.invalidateQueries({ queryKey: ['contacts'] });
          qc.invalidateQueries({ queryKey: ['setup-state'] });
          const skipped = prepared.duplicates + prepared.invalid + prepared.blank;
          toast.success(`${imported.toLocaleString()} people added${skipped ? ` (${skipped} duplicates or bad addresses left out)` : ''}`);
          onImported(list.id);
        } catch (e: any) {
          setNote(e?.response?.data?.error || 'The import did not finish - try again, or use the full importer.');
        } finally {
          setProgress(null);
        }
      },
      error: (err) => setNote(`Could not read that file: ${err.message}`),
    });
  }, [navigate, onImported, qc]);

  return (
    <div>
      <label
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) run(f); }}
        className={cn(
          'relative flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors',
          dragging ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)]' : 'border-[var(--border-default)] hover:bg-[var(--bg-hover)]',
        )}
        data-start-import
      >
        <input
          type="file"
          accept=".csv,.tsv,.txt"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) run(f); e.target.value = ''; }}
          disabled={!!progress}
        />
        {progress ? (
          <>
            <Loader2 className="mb-2 h-5 w-5 animate-spin text-[var(--indigo)]" />
            <p className="text-body font-medium text-[var(--text-primary)]">Adding {progress.done.toLocaleString()} of {progress.total.toLocaleString()}…</p>
          </>
        ) : (
          <>
            <Upload className="mb-2 h-5 w-5 text-[var(--indigo)]" />
            <p className="text-body font-medium text-[var(--text-primary)]">Drop a CSV of your leads, or click to choose one</p>
            <p className="mt-0.5 text-caption text-[var(--text-tertiary)]">Any export works - Apollo, LinkedIn, a spreadsheet. Duplicates and bad addresses are left out for you.</p>
          </>
        )}
      </label>
      {note && <p className="mt-2 text-caption text-rose-600 dark:text-rose-400">{note}</p>}
    </div>
  );
}

/* ── 4. Sequence ─────────────────────────────────────────────────────── */

function SequenceStep({ listId }: { listId: string | null }) {
  const navigate = useNavigate();
  const q = listId ? `&list=${listId}` : '';
  return (
    <div className="space-y-3">
      <p className="text-body text-[var(--text-secondary)]">
        Relay reads who is on your list and what you told it you sell, and writes a short sequence - an opener and two follow-ups - personalised per person. Everything it writes is yours to change before anything is sent.
      </p>
      {!listId && <p className="text-caption text-amber-700 dark:text-amber-400">Add your leads first, so Relay knows who it is writing to.</p>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => navigate(`/campaigns/new?write=1${q}`)} disabled={!listId}>
          <Sparkles className="h-4 w-4" /> Write it with Relay
        </Button>
        <Button variant="secondary" onClick={() => navigate(`/campaigns/new?${q.slice(1)}`)} disabled={!listId}>
          <PenLine className="h-4 w-4" /> I will write it myself
        </Button>
      </div>
    </div>
  );
}

/* ── 5. Launch ───────────────────────────────────────────────────────── */

function LaunchStep({ launched }: { launched: boolean }) {
  if (launched) {
    return (
      <div className="space-y-3" data-start-done>
        <p className="text-body text-[var(--text-secondary)]">
          It is sending on its schedule. Replies arrive in your inbox with Relay's read of each one; interested replies become deals on their own; and the autopilot rests any mailbox that starts bouncing.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link to="/inbox" className="btn-primary inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-body font-semibold">
            <Inbox className="h-4 w-4" /> Open the inbox
          </Link>
          <Link to="/campaigns" className="btn-secondary inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-body font-medium">
            Watch the campaign <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }
  return (
    <p className="text-body text-[var(--text-secondary)]">
      In the builder, press Launch. It checks your mailboxes, DNS and capacity first and fixes what it can right there - anything it cannot fix, it explains. Come back here any time to see where you are.
    </p>
  );
}

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEAL_LABELS, LEAD_ARCHIVE_REASONS, LEAD_STALE_DAYS, leadIsStale, summariseLeads,
} from '@lemlist/shared';
import type { DealLabel, Lead, LeadStatus } from '@lemlist/shared';
import { leadsApi } from '../../api/leads.api';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Spinner } from '../../components/ui/Spinner';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { Avatar } from '../../components/shared/Avatar';
import { SearchInput } from '../../components/shared/SearchInput';
import { usePeek } from '../../components/peek/usePeek';
import { cn } from '../../lib/utils';
import {
  Archive, ArrowRight, Briefcase, Clock, Inbox, RotateCcw, Sparkles, Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';

/* ═══════════════════════════════════════════════════════════════════════
   The inbox between a reply and a forecast.

   Somebody answers "interesting, send me more" and there used to be two
   options, both wrong. Leave them as a contact and they are invisible to
   the pipeline and quietly forgotten. Create a deal and the forecast now
   contains a tyre-kicker — the first stage fills with things nobody has
   qualified, and every conversion rate and stage duration measured against
   it describes a business that does not exist.

   So leads wait here until somebody decides they are real. The decision is
   the product: two buttons, qualify or drop, and a reason either way.
   ═══════════════════════════════════════════════════════════════════════ */

function money(v: number | null | undefined, currency = 'USD'): string {
  if (v === null || v === undefined) return '—';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v || 0);
  } catch { return `$${Math.round(v || 0).toLocaleString()}`; }
}

function ageLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return months === 1 ? 'a month ago' : `${months} months ago`;
}

const LABEL_TONE: Record<DealLabel, string> = {
  hot: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  warm: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  cold: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
};

function personName(lead: Lead): string {
  const c = lead.contact;
  if (!c) return lead.title;
  return [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email;
}

/* ── Qualifying ───────────────────────────────────────────────────────── */

function ConvertDialog({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState(lead.title);
  const [value, setValue] = useState(lead.value == null ? '' : String(lead.value));

  const convert = useMutation({
    mutationFn: () => leadsApi.convert(lead.id, {
      title: title.trim() || lead.title,
      value: value === '' ? 0 : Number(value),
    }),
    onSuccess: ({ deal }) => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['crm'] });
      toast.success('Qualified — now a deal');
      // Straight to the deal. The next thing anybody does after qualifying
      // is book the next step, and that lives on the deal page.
      navigate(`/deals/${deal.id}`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not qualify that lead'),
  });

  return (
    <Modal isOpen onClose={onClose} title="Qualify into a deal" size="sm">
      <form onSubmit={(e) => { e.preventDefault(); convert.mutate(); }} className="space-y-4">
        <p className="text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
          {personName(lead)}
          {lead.company ? ` at ${lead.company}` : ''} moves into the pipeline. The note, label and source
          come with them, and the lead stays here marked converted so the lead-to-deal rate still adds up.
        </p>
        <Input label="Deal name" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
        <Input
          label="Value (USD)"
          type="number"
          min="0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0"
        />
        <p className="-mt-2 text-[11px] text-[var(--text-tertiary)]">
          A rough figure is fine. The commercial shape — recurring, term, one-off — is set on the deal itself.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={convert.isPending || !title.trim()}>
            {convert.isPending ? 'Qualifying…' : 'Create the deal'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ArchiveDialog({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState<string>(LEAD_ARCHIVE_REASONS[0]);

  const archive = useMutation({
    mutationFn: () => leadsApi.archive(lead.id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      toast.success('Dropped');
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not drop that lead'),
  });

  return (
    <Modal isOpen onClose={onClose} title="Drop this lead" size="sm">
      <form onSubmit={(e) => { e.preventDefault(); archive.mutate(); }} className="space-y-4">
        <p className="text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
          It leaves the inbox but is kept. &ldquo;How many leads do we throw away, and why&rdquo; is the
          question that tells you whether the targeting is working, and it cannot be answered from
          rows that were deleted.
        </p>
        <Select
          label="Why"
          options={LEAD_ARCHIVE_REASONS.map((r) => ({ value: r, label: r }))}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={archive.isPending}>
            {archive.isPending ? 'Dropping…' : 'Drop it'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ── The page ─────────────────────────────────────────────────────────── */

const TABS: { id: LeadStatus | 'all'; label: string }[] = [
  { id: 'open', label: 'Inbox' },
  { id: 'converted', label: 'Qualified' },
  { id: 'archived', label: 'Dropped' },
  { id: 'all', label: 'All' },
];

export function LeadsPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { openPeek } = usePeek();
  const [tab, setTab] = useState<LeadStatus | 'all'>('open');
  const [query, setQuery] = useState('');
  const [converting, setConverting] = useState<Lead | null>(null);
  const [archiving, setArchiving] = useState<Lead | null>(null);

  const { data: leads, isLoading } = useQuery({
    queryKey: ['leads', tab],
    queryFn: () => leadsApi.list({ status: tab }),
  });

  // The funnel is measured over everything, not the visible tab, or the
  // conversion rate would change depending on which tab you were looking at.
  const { data: allLeads } = useQuery({
    queryKey: ['leads', 'all'],
    queryFn: () => leadsApi.list({ status: 'all' }),
  });
  const funnel = useMemo(() => summariseLeads(allLeads || []), [allLeads]);

  const setLabel = useMutation({
    mutationFn: ({ id, label }: { id: string; label: DealLabel | null }) => leadsApi.update(id, { label }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
    onError: () => toast.error('Could not set that label'),
  });

  const reopen = useMutation({
    mutationFn: (id: string) => leadsApi.reopen(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['leads'] }); toast.success('Back in the inbox'); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not reopen that lead'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => leadsApi.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['leads'] }); toast.success('Deleted'); },
    onError: () => toast.error('Could not delete that lead'),
  });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return leads || [];
    return (leads || []).filter((l) =>
      [l.title, l.company, l.source, l.contact?.email, personName(l)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)));
  }, [leads, query]);

  const staleCount = useMemo(
    () => (allLeads || []).filter((l) => leadIsStale(l)).length,
    [allLeads],
  );

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--indigo-subtle)]">
            <Inbox className="h-5 w-5 text-[var(--indigo)]" />
          </span>
          <div className="min-w-0">
            <h1 className="text-[19px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">Leads</h1>
            <p className="text-[12.5px] text-[var(--text-tertiary)]">
              People worth a look, held out of the pipeline until you decide they are real.
            </p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <SearchInput value={query} onChange={setQuery} placeholder="Search leads…" className="hidden w-56 sm:block" />
        </div>
      </div>

      {/* The funnel. Rate is over decided leads only — including open ones
          would make it fall every time somebody adds a lead. */}
      {(allLeads?.length || 0) > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2.5">
          <span className="inline-flex items-baseline gap-1.5">
            <span className="text-[11px] text-[var(--text-tertiary)]">In the inbox</span>
            <span className="text-[13px] font-semibold tabular-nums text-[var(--text-primary)]">{funnel.open}</span>
          </span>
          {funnel.openValue > 0 && (
            <span className="inline-flex items-baseline gap-1.5">
              <span className="text-[11px] text-[var(--text-tertiary)]">Estimated</span>
              <span className="text-[13px] font-semibold tabular-nums text-[var(--text-primary)]">{money(funnel.openValue)}</span>
            </span>
          )}
          <span className="inline-flex items-baseline gap-1.5">
            <span className="text-[11px] text-[var(--text-tertiary)]">Qualified</span>
            <span className="text-[13px] font-semibold tabular-nums text-[var(--text-primary)]">{funnel.converted}</span>
          </span>
          {funnel.conversionRate !== null && (
            <span
              className="inline-flex items-baseline gap-1.5"
              title={`${funnel.converted} qualified out of ${funnel.converted + funnel.archived} decided`}
            >
              <span className="text-[11px] text-[var(--text-tertiary)]">Conversion</span>
              <span className="text-[13px] font-semibold tabular-nums text-[var(--indigo)]">{funnel.conversionRate}%</span>
            </span>
          )}
          <span className="flex-1" />
          {staleCount > 0 && (
            <span
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1 text-[11.5px] font-medium text-amber-700 dark:text-amber-400"
              title={`Open for more than ${LEAD_STALE_DAYS} days`}
            >
              <Clock className="h-3.5 w-3.5" />
              {staleCount} waiting on you
            </span>
          )}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors',
              tab === t.id
                ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24"><Spinner size="md" /></div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--bg-surface)] py-16 text-center">
          <Sparkles className="mx-auto mb-3 h-8 w-8 text-[var(--text-muted)]" />
          <p className="text-[14px] font-semibold text-[var(--text-primary)]">
            {query ? `No leads match “${query}”`
              : tab === 'open' ? 'The inbox is clear'
                : tab === 'converted' ? 'Nothing qualified yet'
                  : tab === 'archived' ? 'Nothing dropped yet' : 'No leads yet'}
          </p>
          <p className="mx-auto mt-1 max-w-md text-[12.5px] leading-relaxed text-[var(--text-tertiary)]">
            {tab === 'open'
              ? 'Turn a promising reply into a lead from the contact, and it waits here until you qualify it or drop it.'
              : 'Leads you decide on end up here.'}
          </p>
        </div>
      ) : (
        <div className="panel divide-y divide-[var(--border-subtle)]">
          {visible.map((lead) => {
            const stale = leadIsStale(lead);
            const name = personName(lead);
            return (
              <div key={lead.id} className="group flex flex-wrap items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-[var(--bg-hover)]">
                <button
                  type="button"
                  onClick={() => (lead.contact_id ? openPeek('contact', lead.contact_id) : undefined)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <Avatar name={name} email={lead.contact?.email} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-[12.5px] font-medium text-[var(--text-primary)]">{lead.title}</span>
                      {lead.label && (
                        <span className={cn('rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase', LABEL_TONE[lead.label])}>
                          {lead.label}
                        </span>
                      )}
                      {stale && (
                        <span
                          title={`Open for more than ${LEAD_STALE_DAYS} days — somebody answered and nobody answered back`}
                          className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9.5px] font-bold uppercase text-amber-700 dark:text-amber-400"
                        >
                          <Clock className="h-2.5 w-2.5" /> waiting
                        </span>
                      )}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 text-[11px] text-[var(--text-tertiary)]">
                      <span className="truncate">{name}</span>
                      {lead.contact?.job_title && (
                        <span className="inline-flex items-center gap-1 truncate">
                          <Briefcase className="h-2.5 w-2.5 flex-shrink-0" />{lead.contact.job_title}
                        </span>
                      )}
                      {lead.source && <span className="truncate">via {lead.source}</span>}
                      <span>{ageLabel(lead.created_at)}</span>
                    </span>
                  </span>
                </button>

                {lead.value != null && (
                  <span className="flex-shrink-0 text-[12.5px] font-semibold tabular-nums text-[var(--text-primary)]">
                    {money(lead.value, lead.currency)}
                  </span>
                )}

                {lead.status === 'open' ? (
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <div className="hidden items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 sm:flex">
                      {DEAL_LABELS.map((l) => (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => setLabel.mutate({ id: lead.id, label: lead.label === l.id ? null : l.id })}
                          title={`Mark ${l.label.toLowerCase()}`}
                          className={cn(
                            'rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold transition-colors',
                            lead.label === l.id ? LABEL_TONE[l.id] : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
                          )}
                        >
                          {l.label}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setArchiving(lead)}
                      title="Drop this lead"
                      className="icon-btn h-7 w-7 hover:text-amber-600"
                    >
                      <Archive className="h-3.5 w-3.5" />
                    </button>
                    <Button variant="primary" onClick={() => setConverting(lead)}>
                      Qualify <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : lead.status === 'converted' ? (
                  <button
                    type="button"
                    onClick={() => lead.converted_deal_id && navigate(`/deals/${lead.converted_deal_id}`)}
                    disabled={!lead.converted_deal_id}
                    className="inline-flex flex-shrink-0 items-center gap-1 text-[12px] font-medium text-[var(--indigo)] hover:underline disabled:text-[var(--text-muted)] disabled:no-underline"
                  >
                    {lead.converted_deal_id ? <>Open the deal <ArrowRight className="h-3.5 w-3.5" /></> : 'Deal deleted'}
                  </button>
                ) : (
                  <div className="flex flex-shrink-0 items-center gap-1">
                    {lead.archived_reason && (
                      <span className="text-[11.5px] text-[var(--text-tertiary)]">{lead.archived_reason}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => reopen.mutate(lead.id)}
                      title="Put it back in the inbox"
                      className="icon-btn h-7 w-7"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => confirm(
                        {
                          title: 'Delete this lead?',
                          body: 'It goes for good, and stops counting towards your conversion rate. Dropping it instead keeps the record.',
                          tone: 'danger',
                        },
                        () => remove.mutate(lead.id),
                      )}
                      title="Delete permanently"
                      className="icon-btn h-7 w-7 hover:text-rose-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {converting && <ConvertDialog lead={converting} onClose={() => setConverting(null)} />}
      {archiving && <ArchiveDialog lead={archiving} onClose={() => setArchiving(null)} />}
    </div>
  );
}

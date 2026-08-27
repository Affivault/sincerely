import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEAL_LABELS, DEAL_STAGES, daysInStage, isOpen, nextStep, probabilityOf, rotOf, weightedValue,
} from '@lemlist/shared';
import type {
  CrmEvent, CrmTask, Deal, DealLabel, DealStage,
} from '@lemlist/shared';
import { crmApi } from '../../api/crm.api';
import { ActivityModal, MeetingModal, toDateInput } from '../../components/crm/CrmPrimitives';
import { DealModal } from './DealsPage';
import { DealStageBar } from '../../components/crm/DealStageBar';
import { DealPeople } from '../../components/crm/DealPeople';
import { DealTimeline, type DealRecipient } from '../../components/crm/DealTimeline';
import { DealJourney } from '../../components/crm/DealJourney';
import { OutcomeDialog } from '../../components/crm/OutcomeDialog';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { usePeek } from '../../components/peek/usePeek';
import { cn } from '../../lib/utils';
import {
  AlertTriangle, ArrowLeft, Building2, CalendarClock, CalendarPlus, CheckSquare,
  Clock, Handshake, Pencil, Trash2, TrendingUp,
} from 'lucide-react';
import toast from 'react-hot-toast';

/* ═══════════════════════════════════════════════════════════════════════
   A deal, in full.

   The board answers "what is in the pipeline". It cannot answer "where are
   we with Northbeam", because that answer is made of five things that used
   to live in five places: who is involved, what has been said, what is
   booked next, how long it has taken to get here, and what it is worth
   once you admit the odds.

   Laid out the way the question is actually asked. The stage bar and the
   next step are at the top because they are what you change; the stream is
   the widest column because it is what you read; the numbers and the
   people sit down the side because you refer to them rather than work in
   them.
   ═══════════════════════════════════════════════════════════════════════ */

function money(v: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v || 0);
  } catch { return `$${Math.round(v || 0).toLocaleString()}`; }
}

function spellDays(days: number | null): string {
  if (days === null) return '—';
  if (days <= 0) return 'today';
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  const months = Math.round(days / 30);
  return months === 1 ? '1 month' : `${months} months`;
}

function whenLabel(iso: string | null | undefined): { text: string; tone: string } {
  if (!iso) return { text: 'No date', tone: 'text-[var(--text-muted)]' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { text: 'No date', tone: 'text-[var(--text-muted)]' };
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(d) - startOf(new Date())) / 86_400_000);
  const text = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (diff < 0) return { text: `${text} · ${Math.abs(diff)}d late`, tone: 'text-rose-500' };
  if (diff === 0) return { text: 'Today', tone: 'text-amber-600 dark:text-amber-400' };
  if (diff <= 7) return { text, tone: 'text-amber-600 dark:text-amber-400' };
  return { text, tone: 'text-[var(--text-primary)]' };
}

const LABEL_TONE: Record<DealLabel, string> = {
  hot: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30',
  warm: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
  cold: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30',
};

function Field({ label, value, tone, title }: { label: string; value: string; tone?: string; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5" title={title}>
      <span className="flex-shrink-0 text-[11.5px] text-[var(--text-tertiary)]">{label}</span>
      <span className={cn('min-w-0 truncate text-right text-[12.5px] font-medium tabular-nums', tone || 'text-[var(--text-primary)]')}>
        {value}
      </span>
    </div>
  );
}

export function DealDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { openPeek } = usePeek();

  const [editing, setEditing] = useState(false);
  const [taskModal, setTaskModal] = useState<Partial<CrmTask> | null | undefined>(undefined);
  const [eventModal, setEventModal] = useState<Partial<CrmEvent> | null | undefined>(undefined);
  const [outcome, setOutcome] = useState<'won' | 'lost' | null>(null);
  /* Who the compose box is pointed at. Lives here so the mail icon beside
     somebody in the People panel aims the one compose box on the page. */
  const [writeTo, setWriteTo] = useState<DealRecipient | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['crm', 'deal-detail', id],
    queryFn: () => crmApi.dealDetail(id!),
    enabled: !!id,
    retry: false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['crm'] });

  const move = useMutation({
    mutationFn: ({ stage, reason }: { stage: DealStage; reason?: string | null }) =>
      crmApi.updateDeal(id!, { stage, ...(reason !== undefined ? { outcome_reason: reason } : {}) } as any),
    onSuccess: (_r, v) => {
      invalidate();
      toast.success(
        v.stage === 'won' ? 'Marked won'
          : v.stage === 'lost' ? 'Marked lost'
            : `Moved to ${DEAL_STAGES.find((s) => s.id === v.stage)?.label}`,
      );
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not move that deal'),
  });

  const setLabel = useMutation({
    mutationFn: (label: DealLabel | null) => crmApi.updateDeal(id!, { label } as any),
    onSuccess: invalidate,
    onError: () => toast.error('Could not set that label'),
  });

  const del = useMutation({
    mutationFn: () => crmApi.deleteDeal(id!),
    onSuccess: () => { invalidate(); toast.success('Deal deleted'); navigate('/deals'); },
    onError: () => toast.error('Could not delete that deal'),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-24"><Spinner size="md" /></div>;
  }

  if (isError || !data) {
    const status = (error as any)?.response?.status;
    return (
      <div className="panel py-16 text-center">
        <Handshake className="mx-auto mb-3 h-8 w-8 text-[var(--text-muted)]" />
        <p className="text-[14px] font-semibold text-[var(--text-primary)]">
          {status === 404 ? 'That deal no longer exists' : 'Could not load that deal'}
        </p>
        <p className="mb-4 mt-1 text-[12.5px] text-[var(--text-tertiary)]">
          {status === 404
            ? 'It may have been deleted from another tab or by somebody else on the team.'
            : 'The request failed. It is worth trying again.'}
        </p>
        <Button variant="secondary" onClick={() => navigate('/deals')}>
          <ArrowLeft className="h-4 w-4" /> Back to the pipeline
        </Button>
      </div>
    );
  }

  const { deal, participants, tasks, events, notes, history, emails } = data;
  const stageMeta = DEAL_STAGES.find((s) => s.id === deal.stage);
  const rot = rotOf(deal);
  const step = nextStep(deal, tasks, events);
  const close = whenLabel(deal.expected_close_date);
  const companyId = deal.company_id || deal.contact?.company_id || null;
  const primaryName = deal.contact
    ? [deal.contact.first_name, deal.contact.last_name].filter(Boolean).join(' ') || deal.contact.email
    : deal.contact_name;

  /*
   * Everybody on the deal who can actually be written to, primary first and
   * de-duplicated: a participant who is also the primary contact would
   * otherwise appear twice in the recipient row.
   */
  const recipients: DealRecipient[] = [];
  const seen = new Set<string>();
  const pushRecipient = (email: string | null | undefined, name: string | null | undefined) => {
    const address = email?.trim().toLowerCase();
    if (!address || seen.has(address)) return;
    seen.add(address);
    recipients.push({ email: address, name: name?.trim() || address });
  };
  pushRecipient(deal.contact?.email || deal.contact_email, primaryName);
  for (const p of participants) {
    pushRecipient(p.contact?.email, [p.contact?.first_name, p.contact?.last_name].filter(Boolean).join(' '));
  }

  const onStage = (stage: DealStage) => {
    if (stage === deal.stage) return;
    // Ending a deal asks why. It is the one stage change whose reason is
    // worth more later than the change itself, and the only moment anybody
    // remembers it.
    if (stage === 'won' || stage === 'lost') { setOutcome(stage); return; }
    move.mutate({ stage });
  };

  const taskDefaults = () => ({
    deal_id: deal.id,
    contact_id: deal.contact_id,
    contact_name: primaryName,
  });

  return (
    <div>
      <Link
        to="/deals"
        className="group mb-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
      >
        <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
        Pipeline
      </Link>

      {/* Header */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--indigo-subtle)]">
            <Handshake className="h-5 w-5 text-[var(--indigo)]" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[19px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">{deal.title}</h1>
              {deal.label && (
                <span className={cn('rounded-full border px-2 py-0.5 text-[10.5px] font-semibold uppercase', LABEL_TONE[deal.label])}>
                  {deal.label}
                </span>
              )}
              {rot.rotting && isOpen(deal.stage) && (
                <span
                  title={`No movement for ${rot.days} days — ${stageMeta?.label.toLowerCase()} deals are expected to move within ${rot.limit}`}
                  className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-rose-600 dark:text-rose-400"
                >
                  <Clock className="h-3 w-3" /> Stalled {rot.days}d
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-[var(--text-tertiary)]">
              {deal.company && (
                <button
                  type="button"
                  onClick={() => (companyId ? openPeek('company', companyId) : navigate(`/companies?q=${encodeURIComponent(deal.company!)}`))}
                  className="inline-flex items-center gap-1 transition-colors hover:text-[var(--indigo)] hover:underline"
                >
                  <Building2 className="h-3.5 w-3.5" />{deal.company}
                </button>
              )}
              <span className="font-semibold text-[var(--text-primary)]">{money(deal.value, deal.currency)}</span>
              {deal.source && <span>via {deal.source}</span>}
            </div>
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] p-0.5">
            {DEAL_LABELS.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setLabel.mutate(deal.label === l.id ? null : l.id)}
                title={deal.label === l.id ? `Clear the ${l.label.toLowerCase()} label` : `Mark this deal ${l.label.toLowerCase()}`}
                className={cn(
                  'rounded-md px-2 py-1 text-[11.5px] font-semibold transition-colors',
                  deal.label === l.id
                    ? LABEL_TONE[l.id]
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
          <Button variant="secondary" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" /> Edit
          </Button>
          <button
            type="button"
            onClick={() => confirm(
              {
                title: `Delete "${deal.title}"?`,
                body: 'The deal, its notes and its stage history go. Contacts, companies, activities and meetings stay.',
                tone: 'danger',
              },
              () => del.mutate(),
            )}
            className="icon-btn h-9 w-9 hover:text-rose-500"
            title="Delete this deal"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mb-3">
        <DealStageBar deal={deal} history={history} onStage={onStage} busy={move.isPending} />
      </div>

      {/* The next step. Activity-based selling in one line: a live deal with
          nothing booked against it is not fine, it is forgotten. */}
      {isOpen(deal.stage) && (
        <div
          className={cn(
            'mb-4 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5',
            step.missing
              ? 'border-amber-500/30 bg-amber-500/[0.07]'
              : step.overdue
                ? 'border-rose-500/30 bg-rose-500/[0.07]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]',
          )}
        >
          {step.missing ? (
            <>
              <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
              <span className="text-[12.5px] font-medium text-[var(--text-primary)]">Nothing is scheduled on this deal.</span>
              <span className="text-[12px] text-[var(--text-tertiary)]">
                Deals without a next step are the ones that go quiet.
              </span>
            </>
          ) : (
            <>
              <CalendarClock className={cn('h-4 w-4 flex-shrink-0', step.overdue ? 'text-rose-500' : 'text-[var(--indigo)]')} />
              <span className="text-[12.5px] text-[var(--text-primary)]">
                <span className="font-medium">{step.overdue ? 'Overdue:' : 'Next:'}</span> {step.title}
              </span>
              <span className={cn('text-[12px]', step.overdue ? 'font-medium text-rose-500' : 'text-[var(--text-tertiary)]')}>
                {whenLabel(step.at).text}
              </span>
            </>
          )}
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => setTaskModal(taskDefaults())}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-semibold text-[var(--indigo)] transition-colors hover:bg-[var(--indigo-subtle)]"
          >
            <CheckSquare className="h-3.5 w-3.5" /> {step.missing ? 'Schedule one' : 'Add another'}
          </button>
          <button
            type="button"
            onClick={() => setEventModal({
              ...taskDefaults(),
              contact_email: deal.contact?.email || deal.contact_email,
              title: `Call — ${deal.company || primaryName || deal.title}`,
            })}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-semibold text-[var(--indigo)] transition-colors hover:bg-[var(--indigo-subtle)]"
          >
            <CalendarPlus className="h-3.5 w-3.5" /> Book
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DealTimeline
            deal={deal}
            notes={notes}
            tasks={tasks}
            events={events}
            emails={emails}
            history={history}
            recipients={recipients}
            writeTo={writeTo}
            onWriteTo={setWriteTo}
            onAddActivity={() => setTaskModal(taskDefaults())}
            onBookMeeting={() => setEventModal({
              ...taskDefaults(),
              contact_email: deal.contact?.email || deal.contact_email,
              title: `Call — ${deal.company || primaryName || deal.title}`,
            })}
          />
        </div>

        <div className="space-y-4">
          <div className="panel p-3.5">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Summary</p>
            <div className="divide-y divide-[var(--border-subtle)]">
              <Field label="Value" value={money(deal.value, deal.currency)} />
              <Field
                label="Weighted"
                value={money(weightedValue(deal), deal.currency)}
                title={`${probabilityOf(deal)}% of ${money(deal.value, deal.currency)}`}
                tone="text-[var(--indigo)]"
              />
              <Field label="Probability" value={`${probabilityOf(deal)}%`} />
              <Field label="Expected close" value={close.text} tone={close.tone} />
              <Field label="In stage" value={spellDays(daysInStage(deal))} tone={rot.rotting ? 'text-rose-500' : undefined} />
              <Field label="Deal age" value={spellDays(Math.floor((Date.now() - new Date(deal.created_at).getTime()) / 86_400_000))} />
              {deal.source && <Field label="Source" value={deal.source} />}
              {deal.outcome_reason && (
                <Field
                  label={deal.stage === 'won' ? 'Won because' : 'Lost because'}
                  value={deal.outcome_reason}
                  tone={deal.stage === 'won' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}
                />
              )}
            </div>
            {isOpen(deal.stage) && (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-[var(--text-muted)]">
                <TrendingUp className="mt-px h-3 w-3 flex-shrink-0" />
                Weighted is what this deal contributes to the forecast. Give it its own probability on the edit form to override the stage default.
              </p>
            )}
          </div>

          <DealPeople deal={deal} participants={participants} onEmail={(email, name) => setWriteTo({ email, name })} />

          <div className="panel p-3.5">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Journey</p>
            <DealJourney deal={deal} events={history} />
          </div>

          {deal.notes?.trim() && (
            <div className="panel p-3.5">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Deal notes</p>
              <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--text-secondary)]">{deal.notes}</p>
            </div>
          )}
        </div>
      </div>

      {outcome && (
        <OutcomeDialog
          deal={deal}
          stage={outcome}
          onCancel={() => setOutcome(null)}
          onConfirm={(reason) => { const stage = outcome; setOutcome(null); move.mutate({ stage, reason }); }}
        />
      )}
      {editing && <DealModal deal={deal as Partial<Deal>} onClose={() => setEditing(false)} />}
      {taskModal !== undefined && <ActivityModal task={taskModal} onClose={() => setTaskModal(undefined)} />}
      {eventModal !== undefined && <MeetingModal event={eventModal} onClose={() => setEventModal(undefined)} />}
    </div>
  );
}

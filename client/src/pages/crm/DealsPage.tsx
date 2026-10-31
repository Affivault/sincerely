import { useDealHealth } from '../../components/crm/DealHealth';
import { DealCard, dealCompanyId } from '../../components/crm/DealCard';
import { ForecastBoard } from '../../components/crm/ForecastBoard';
import { nextStepsByDeal, type NextStepInfo } from '../../components/crm/NextActivity';
import { PipelineEditor } from '../../components/crm/PipelineEditor';
import { usePipelines } from '../../hooks/usePipelines';
import { usePopover } from '../../hooks/usePopover';
import { useState, useMemo, useEffect, useId, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { crmApi } from '../../api/crm.api';
import { PageHeader } from '../../components/shared/PageHeader';
import { ActivityModal, MeetingModal, ContactPicker, toDateInput } from '../../components/crm/CrmPrimitives';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { SkeletonList } from '../../components/ui/Skeleton';
import { usePendingRemoval } from '../../components/ui/UndoBar';
import { SearchInput } from '../../components/shared/SearchInput';
import { usePeek } from '../../components/peek/usePeek';
import { PipelineHeader } from '../../components/crm/PipelineHeader';
import { DealTable, type SortKey, type SortDir } from '../../components/crm/DealTable';
import { OutcomeDialog } from '../../components/crm/OutcomeDialog';
import {
  DealFilters, applyDealFilters, EMPTY_FILTERS,
  type DealFilterState, type DealView,
} from '../../components/crm/DealFilters';
import { useFillViewport, autoScrollX, autoScrollY } from '../../hooks/useFillViewport';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';
import { EmptyState } from '../../components/shared/EmptyState';
import {
  AlertTriangle, BarChart3, Check, ChevronDown, Clock, Download, Handshake,
  Layers, Plus, Settings2, Star, Trash2, Trophy, XCircle,
} from 'lucide-react';
import {
  dealStageLabel,
  isOpen,
  rotOf,
  weightedValue,
  hasEconomics,
  revenueSplit,
  totalContractValue,
  DEFAULT_TERM_MONTHS,
  STAGE_PROBABILITY,
  type Deal, type DealStage, type CreateDealInput,
  type CrmTask,
  type CrmEvent,
  type ContactWithTags,
  type Pipeline,
  PLACEHOLDER, formatDayMonth, formatMoney, parseDay } from '@lemlist/shared';
// Shared, so every export guards against spreadsheet formulas the same way.
import { csvCell } from '@lemlist/shared';

/* ─── Helpers ─────────────────────────────────────── */
function fmtMoney(v: number, currency = 'USD'): string {
  return formatMoney(v, currency);
}
/** Best display name for the lead attached to a deal (live contact wins). */
function leadName(d: Deal): string | null {
  if (d.contact) {
    const n = [d.contact.first_name, d.contact.last_name].filter(Boolean).join(' ');
    if (n) return n;
  }
  return d.contact_name || d.contact?.email || d.contact_email || null;
}
function leadEmail(d: Deal): string | null {
  return d.contact?.email || d.contact_email || null;
}
/** The lead's contact record, when the deal is actually linked to one. */
function leadId(d: Deal): string | null {
  return d.contact_id || d.contact?.id || null;
}

/** Export the given deals as a CSV file the browser downloads directly — no server round-trip. */
function exportDealsCsv(deals: Deal[], stageLabel: (d: Deal) => string, pipelineName: (d: Deal) => string) {
  const header = ['Title', 'Company', 'Contact name', 'Contact email', 'Pipeline', 'Stage', 'Value', 'Expected close date', 'Notes'];
  const rows = deals.map(d => [
    d.title, d.company, leadName(d), leadEmail(d), pipelineName(d), stageLabel(d),
    d.value || 0, d.expected_close_date ? toDateInput(d.expected_close_date) : '', d.notes,
  ].map(csvCell).join(','));
  const csv = [header.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `deals-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** '' means nobody has said. Distinct from 0, which is a real answer. */
function blankToNull(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}


/* ─── Lead picker ─────────────────────────────────── */
/* ─── Deal modal ──────────────────────────────────── */
export function DealModal({ deal, onClose, onDeleted }: { deal: Partial<Deal> | null; onClose: () => void; onDeleted?: () => void }) {
  const a11yId = useId();
  const qc = useQueryClient();
  const editing = !!deal?.id;
  const [form, setForm] = useState<CreateDealInput & { stage: DealStage }>({
    title: deal?.title || '',
    company: deal?.company || '',
    // The account record, when the deal starts from one. Typing a different
    // name below unlinks it; the server then links the contact's company.
    company_id: deal?.company_id || deal?.contact?.company_id || null,
    contact_name: deal?.contact_name || (deal?.contact ? [deal.contact.first_name, deal.contact.last_name].filter(Boolean).join(' ') : '') || '',
    contact_email: deal?.contact_email || deal?.contact?.email || null,
    contact_id: deal?.contact_id || deal?.contact?.id || null,
    value: deal?.value ?? 0,
    stage: (deal?.stage as DealStage) || 'lead',
    expected_close_date: toDateInput(deal?.expected_close_date) || '',
    notes: deal?.notes || '',
    // Empty means "use the stage default", which is what almost every deal
    // should be. Stored as a string so the field can be cleared back to that.
    probability: deal?.probability == null ? '' : String(deal.probability),
    /* The commercial shape. All strings so every field can be cleared back
       to "not stated", which is a different claim from zero. */
    recurring_amount: deal?.recurring_amount == null ? '' : String(deal.recurring_amount),
    recurring_period: deal?.recurring_period || 'month',
    one_off_amount: deal?.one_off_amount == null ? '' : String(deal.one_off_amount),
    term_months: deal?.term_months == null ? '' : String(deal.term_months),
  } as any);
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  /* Where it sits: a pipeline, then a named stage in it (or won / lost).
     Null until somebody picks, so the defaults follow the pipelines as they
     load rather than freezing whatever was known on the first render. */
  const pipes = usePipelines();
  const [pipelineId, setPipelineId] = useState<string | null>(deal?.pipeline_id || null);
  const [stageChoice, setStageChoice] = useState<string | null>(
    deal?.stage === 'won' || deal?.stage === 'lost' ? deal.stage : deal?.stage_id || null,
  );
  const activePipeline = (pipelineId && pipes.pipelines.find((p) => p.id === pipelineId))
    || pipes.pipelineOf({ pipeline_id: deal?.pipeline_id ?? null });
  const choice = stageChoice
    ?? activePipeline?.stages.find((s) => s.phase === form.stage)?.id
    ?? activePipeline?.stages[0]?.id
    ?? form.stage;
  const chosenStage = activePipeline?.stages.find((s) => s.id === choice) || null;
  const effectiveStage: DealStage = choice === 'won' || choice === 'lost' ? choice : chosenStage?.phase || form.stage;
  const stageDefault = chosenStage?.probability ?? STAGE_PROBABILITY[effectiveStage];

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        stage: effectiveStage,
        ...(pipes.ready && chosenStage ? { stage_id: chosenStage.id, pipeline_id: chosenStage.pipeline_id } : {}),
        value: Number(form.value) || 0,
        expected_close_date: form.expected_close_date || null,
        contact_email: form.contact_email || null,
        contact_id: form.contact_id || null,
        // Left out rather than null when unlinked, so the server can link the
        // contact's own company instead.
        company_id: (form as any).company_id || undefined,
        contact_name: form.contact_name?.trim() || null,
        // '' is a cleared field and means "no opinion, use the stage". 0 is a
        // real answer that means the deal is dead, so the two must not collapse.
        probability: (form as any).probability === '' ? null : Number((form as any).probability),
        // Same rule throughout: '' means nobody has said, and must not
        // collapse to 0, which for a fee or a term is a real answer.
        recurring_amount: blankToNull((form as any).recurring_amount),
        recurring_period: (form as any).recurring_period || 'month',
        one_off_amount: blankToNull((form as any).one_off_amount),
        term_months: blankToNull((form as any).term_months),
      };
      return editing ? crmApi.updateDeal(deal!.id!, payload) : crmApi.createDeal(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm'] });
      // The contact's own page reads its deals under these keys.
      qc.invalidateQueries({ queryKey: ['contact-crm'] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
      toast.success(editing ? 'Deal updated' : 'Deal added');
      onClose();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save deal'),
  });
  // Deleting is deferred behind the undo bar rather than asked about: the
  // modal closes, the card leaves the board, and the request goes a few
  // seconds later unless they take it back.
  const gone = usePendingRemoval();
  const deleteDeal = () => {
    const id = deal!.id!;
    gone.remove(id, `Deleted "${form.title || 'deal'}"`, async () => {
      await crmApi.deleteDeal(id);
      qc.invalidateQueries({ queryKey: ['crm'] });
      qc.invalidateQueries({ queryKey: ['contact-crm'] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
    });
    onClose();
    onDeleted?.();
  };

  /* The shape as the shared arithmetic wants it, so the figure shown while
     typing is the same one the server will compute and store. */
  const shape = {
    recurring_amount: blankToNull((form as any).recurring_amount),
    recurring_period: (form as any).recurring_period,
    one_off_amount: blankToNull((form as any).one_off_amount),
    term_months: blankToNull((form as any).term_months),
  };
  const shaped = hasEconomics(shape);
  const split = revenueSplit(shape);
  const effectiveValue = shaped ? totalContractValue(shape) : Number(form.value) || 0;

  const linkContact = (c: ContactWithTags) => {
    const full = [c.first_name, c.last_name].filter(Boolean).join(' ');
    setForm(f => ({
      ...f,
      contact_id: c.id,
      contact_email: c.email,
      contact_name: full || c.email,
      company: f.company || c.company || '',
      company_id: (f as any).company_id || (c as any).company_id || null,
    }));
  };

  const [showShape, setShowShape] = useState(false);

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={editing ? 'Edit deal' : 'New deal'}
      size="md"
      // Pinned, not at the end of the form: the form is taller than most
      // screens, and "Add deal" sat below the fold with nothing to say so.
      footer={
        <>
          {editing ? (
            <button type="button" onClick={deleteDeal} className="mr-auto flex items-center gap-1.5 text-body font-medium text-rose-600 dark:text-rose-400 hover:text-rose-700 transition-colors">
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          ) : null}
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="deal-form" disabled={save.isPending || !form.title.trim()}>{save.isPending ? 'Saving…' : editing ? 'Save' : 'Add deal'}</Button>
        </>
      }
    >
      <form id="deal-form" onSubmit={(e) => { e.preventDefault(); if (form.title.trim()) save.mutate(); }} className="space-y-4">
        <Input label="Deal name" value={form.title} onChange={e => set('title', e.target.value)} placeholder={`e.g. ${PLACEHOLDER.company} — annual plan`} required autoFocus />
        <ContactPicker
          label="Contact"
          contactId={form.contact_id || null}
          contactName={form.contact_name || ''}
          contactEmail={form.contact_email || null}
          onName={v => set('contact_name', v)}
          onLink={linkContact}
          onUnlink={() => setForm(f => ({ ...f, contact_id: null, contact_email: null, contact_name: '' }))}
        />
        <Input
          label="Company"
          value={form.company || ''}
          onChange={e => setForm(f => ({ ...f, company: e.target.value, company_id: e.target.value === (deal?.company || '') ? (deal?.company_id ?? null) : null }))}
          placeholder={PLACEHOLDER.company}
          hint={form.company_id ? 'Linked to the company record' : undefined}
        />
        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Stage"
            options={[
              ...(activePipeline?.stages || []).map((st) => ({ value: st.id, label: st.name })),
              { value: 'won', label: 'Won' },
              { value: 'lost', label: 'Lost' },
            ]}
            value={choice}
            onChange={e => setStageChoice(e.target.value)}
          />
          <Input label="Close date" type="date" value={form.expected_close_date || ''} onChange={e => set('expected_close_date', e.target.value)} />
        </div>
        {pipes.pipelines.length > 1 && (
          <Select
            label="Pipeline"
            options={pipes.pipelines.map((p) => ({ value: p.id, label: p.name }))}
            value={activePipeline?.id || ''}
            onChange={(e) => {
              const next = pipes.pipelines.find((p) => p.id === e.target.value);
              setPipelineId(e.target.value);
              // A closed deal stays closed; an open one starts the new pipeline
              // at the stage that matches how far along it already is.
              if (next && choice !== 'won' && choice !== 'lost') {
                setStageChoice((next.stages.find((st) => st.phase === effectiveStage) || next.stages[0])?.id || null);
              }
            }}
          />
        )}

        {!shaped && (
          <Input
            label="Deal value (USD)"
            type="number"
            min="0"
            value={String(form.value ?? 0)}
            onChange={e => set('value', e.target.value)}
          />
        )}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <Input
              label="Win probability"
              type="number"
              min="0"
              max="100"
              value={(form as any).probability ?? ''}
              onChange={e => set('probability', e.target.value)}
              placeholder={String(stageDefault)}
            />
            <p className="mt-1 text-caption text-[var(--text-tertiary)]">
              Leave blank for the stage default ({stageDefault}%).
            </p>
          </div>
          <div className="col-span-2 flex items-end pb-[26px]">
            <p className="text-body text-[var(--text-secondary)]">
              Weighted at{' '}
              <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                {fmtMoney(
                  (effectiveValue *
                    ((form as any).probability === '' || (form as any).probability == null
                      ? stageDefault
                      : Number((form as any).probability) || 0)) / 100,
                )}
              </span>{' '}
              in the forecast.
            </p>
          </div>
        </div>
        {/* The recurring / one-off breakdown, for the deals that need one -
            behind a toggle, after the value, so the one number most deals
            are sits where people look for it. Open when the deal has one. */}
        {!showShape && !shaped ? (
          <button type="button" onClick={() => setShowShape(true)} className="text-body font-medium text-[var(--indigo-text)] hover:underline">
            + Recurring or one-off parts
          </button>
        ) : (
          <>
        {/* The commercial shape.

            A single "value" cannot tell a three-year retainer apart from a
            one-off project of the same headline size, and in B2B those are
            not remotely the same deal. Describe the parts and the total
            follows; leave them all blank and the plain figure below is
            used exactly as it always was. */}
        <div className="rounded-xl border border-[var(--border-subtle)] p-3">
          <p className="mb-2.5 text-caption font-medium text-[var(--text-tertiary)]">
            Commercial shape
          </p>
          <div className="grid grid-cols-3 gap-3">
            <Input
              label="Recurring"
              type="number"
              min="0"
              placeholder="0"
              value={(form as any).recurring_amount}
              onChange={e => set('recurring_amount', e.target.value)}
            />
            <Select
              label="Per"
              options={[
                { value: 'month', label: 'Month' },
                { value: 'quarter', label: 'Quarter' },
                { value: 'year', label: 'Year' },
              ]}
              value={(form as any).recurring_period}
              onChange={e => set('recurring_period', e.target.value)}
            />
            <Input
              label="Term (months)"
              type="number"
              min="1"
              step="1"
              placeholder={String(DEFAULT_TERM_MONTHS)}
              value={(form as any).term_months}
              onChange={e => set('term_months', e.target.value)}
            />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Input
              label="One-off fee"
              type="number"
              min="0"
              placeholder="0"
              value={(form as any).one_off_amount}
              onChange={e => set('one_off_amount', e.target.value)}
            />
            <div className="col-span-2 flex items-end pb-1">
              {shaped ? (
                <p className="text-body leading-relaxed text-[var(--text-secondary)]">
                  Worth{' '}
                  <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                    {fmtMoney(totalContractValue(shape))}
                  </span>{' '}
                  over {split.months} months
                  {split.termAssumed && <span className="text-[var(--text-tertiary)]"> (assumed)</span>}
                  {split.arr > 0 && (
                    <>
                      {' · '}
                      <span className="font-semibold tabular-nums text-[var(--indigo-text)]">
                        {fmtMoney(split.arr)}
                      </span>{' '}
                      new ARR
                    </>
                  )}
                </p>
              ) : (
                <p className="text-body text-[var(--text-tertiary)]">
                  Leave blank for a deal that is just one number.
                </p>
              )}
            </div>
          </div>
        </div>

          </>
        )}
        <div>
          <label htmlFor={`${a11yId}-f1`} className="block text-body font-medium text-[var(--text-secondary)] mb-1">Notes</label>
          <textarea id={`${a11yId}-f1`} value={form.notes || ''} onChange={e => set('notes', e.target.value)} rows={3} placeholder="Context, next steps…" className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-strong text-[var(--text-primary)] outline-none focus:border-[var(--indigo)] focus-visible:shadow-[var(--ring-focus)]" />
        </div>
      </form>
    </Modal>
  );
}

/* ─── Pipeline (deals kanban) ─────────────────────── */

/** A column on the board: a named stage of the pipeline, or how deals end. */
interface BoardColumn {
  id: string;
  name: string;
  kind: 'stage' | 'won' | 'lost';
  phase: DealStage;
  probability: number;
}

function PipelineBoard({
  columns, deals, columnOf, next, onOpen, onOutcome, onDelete, onAddToColumn, dragDisabled,
}: {
  columns: BoardColumn[];
  deals: Deal[];
  columnOf: (d: Deal) => string;
  next: Map<string, NextStepInfo>;
  onOpen: (d: Deal) => void;
  onOutcome: (d: Deal, stage: 'won' | 'lost') => void;
  onDelete: (d: Deal) => void;
  onAddToColumn: (col: BoardColumn) => void;
  dragDisabled?: boolean;
}) {
  const { data: health } = useDealHealth();
  const qc = useQueryClient();
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ col: string; index: number } | null>(null);
  const [zone, setZone] = useState<'won' | 'lost' | 'delete' | null>(null);
  // The board owns the rest of the screen; each column scrolls inside it.
  const { ref: boardRef, height } = useFillViewport<HTMLDivElement>({ min: 320 });

  const openWeighted = deals.filter((d) => isOpen(d.stage)).reduce((s, d) => s + weightedValue(d), 0);

  const endDrag = () => { setDragId(null); setOver(null); setZone(null); };

  // Reorder within a column, or move to another stage at a given index. Fresh
  // sequential positions for the affected column are saved optimistically.
  const commit = (colId: string, index: number) => {
    const id = dragId;
    if (!id) return;
    const col = columns.find((c) => c.id === colId);
    const all = qc.getQueryData<Deal[]>(['crm', 'deals']) || deals;
    const moving = all.find((d) => d.id === id);
    if (!col || !moving) return;

    // Ending a deal asks why first. Won and lost are a record, not a queue,
    // so there is no order to keep inside them.
    if (col.kind !== 'stage') {
      if (moving.stage !== col.kind) onOutcome(moving, col.kind);
      return;
    }

    /* `index` was measured against the on-screen column, which is filtered,
       while positions are saved against the whole column. Find the next
       visible card below the drop point and insert before that same card in
       the full list, so a filtered board still reorders correctly. */
    const visible = deals.filter((d) => columnOf(d) === colId);
    const target = all.filter((d) => d.id !== id && isOpen(d.stage) && columnOf(d) === colId);
    let anchorId: string | undefined;
    for (let i = index; i < visible.length; i++) {
      if (visible[i].id !== id) { anchorId = visible[i].id; break; }
    }
    const anchorPos = anchorId ? target.findIndex((d) => d.id === anchorId) : -1;
    const insertAt = anchorPos !== -1 ? anchorPos : target.length;
    const order = [...target.slice(0, insertAt), moving, ...target.slice(insertAt)];
    const crossing = columnOf(moving) !== colId || !isOpen(moving.stage);
    const rebuilt = order.map((d, i) => (d.id === id
      ? { ...d, stage: col.phase, stage_id: col.id, position: i }
      : { ...d, position: i }));
    const changed = rebuilt.filter((d, i) => d.id === id || order[i].position !== i);
    const changedIds = new Set(changed.map((d) => d.id));

    qc.setQueryData<Deal[]>(['crm', 'deals'], (old) => (old || []).map((d) => (changedIds.has(d.id) ? rebuilt.find((r) => r.id === d.id)! : d)));
    // allSettled: one failing card must not report the whole batch as failed.
    Promise.allSettled(changed.map((d) => crmApi.updateDeal(d.id, d.id === id
      ? { stage: col.phase, stage_id: col.id, position: d.position }
      : { position: d.position })))
      .then((results) => {
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed > 0) {
          toast.error(failed === changed.length ? 'Could not move that deal' : `${failed} of ${changed.length} cards failed to save`);
        } else if (crossing) {
          toast.success(`Moved to ${col.name}`);
        }
        qc.invalidateQueries({ queryKey: ['crm'] });
      });
  };

  const dropOnZone = (z: 'won' | 'lost' | 'delete') => {
    const deal = deals.find((d) => d.id === dragId);
    endDrag();
    if (!deal) return;
    if (z === 'delete') onDelete(deal);
    else if (deal.stage !== z) onOutcome(deal, z);
  };

  return (
    <>
      <div
        ref={boardRef}
        style={height ? { height } : undefined}
        onDragOver={(e) => autoScrollX(boardRef.current, e.clientX)}
        className="flex gap-3 overflow-x-auto pb-2"
      >
        {columns.map((col, colIndex) => {
          const items = deals.filter((d) => columnOf(d) === col.id);
          const total = items.reduce((s, d) => s + (Number(d.value) || 0), 0);
          const weighted = items.reduce((s, d) => s + weightedValue(d), 0);
          const share = col.kind === 'stage' && openWeighted > 0 ? Math.round((weighted / openWeighted) * 100) : 0;
          const dropHere = over?.col === col.id;
          const stalled = col.kind === 'stage' ? items.filter((d) => rotOf(d).rotting).length : 0;
          return (
            <section
              key={col.id}
              aria-label={col.name}
              onDragOver={(e) => { e.preventDefault(); if (dragId) setOver({ col: col.id, index: items.length }); }}
              onDrop={(e) => { e.preventDefault(); if (dragId && over) commit(over.col, over.index); endDrag(); }}
              className={cn(
                'flex-shrink-0 w-72 rounded-2xl border flex flex-col h-full min-h-0 transition-colors',
                dropHere
                  ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)]'
                  : col.kind === 'won'
                    ? 'border-emerald-500/25 bg-emerald-500/5'
                    : col.kind === 'lost'
                      ? 'border-rose-500/25 bg-rose-500/5'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-muted)]/40',
              )}
            >
              {/* Outside the scroll area, so the stage, its count and its
                  total stay put however far down the column you are. */}
              <header className="flex-shrink-0 px-3 pt-3 pb-2">
                <div className="flex items-center gap-2">
                  {col.kind === 'stage' ? (
                    <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[var(--indigo-subtle)] text-micro font-semibold tabular-nums text-[var(--indigo-text)]">{colIndex + 1}</span>
                  ) : col.kind === 'won' ? (
                    <Trophy className="h-4 w-4 flex-shrink-0 text-emerald-500" />
                  ) : (
                    <XCircle className="h-4 w-4 flex-shrink-0 text-rose-500" />
                  )}
                  <h3 className="min-w-0 truncate text-strong font-semibold text-[var(--text-primary)]">{col.name}</h3>
                  <span className="flex-shrink-0 rounded-full bg-[var(--bg-surface)] px-1.5 text-micro font-semibold tabular-nums text-[var(--text-secondary)] shadow-[var(--shadow-sm)]">{items.length}</span>
                  <span className="flex-1" />
                  {col.kind === 'stage' && (
                    <>
                      <span className="text-micro tabular-nums text-[var(--text-tertiary)]" title="Odds a deal in this stage closes">{col.probability}%</span>
                      <button
                        type="button"
                        onClick={() => onAddToColumn(col)}
                        title={`Add a deal straight into ${col.name}`}
                        aria-label={`Add a deal to ${col.name}`}
                        className="icon-btn h-6 w-6 -mr-1 text-[var(--text-tertiary)] hover:text-[var(--indigo-text)]"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
                <div className="mt-1.5 flex items-baseline gap-1.5">
                  <span className="text-strong font-semibold tabular-nums text-[var(--text-primary)]">{fmtMoney(total)}</span>
                  {/* The number the forecast uses, next to the one everybody
                      quotes: a column total nobody discounts is how a
                      pipeline ends up promising twice what it delivers. */}
                  {col.kind === 'stage' && weighted !== total && (
                    <span className="text-micro tabular-nums text-[var(--text-tertiary)]" title="Weighted by each deal's odds">{fmtMoney(weighted)} weighted</span>
                  )}
                  {stalled > 0 && (
                    <span className="ml-auto inline-flex items-center gap-0.5 text-micro font-semibold tabular-nums text-rose-600 dark:text-rose-400" title="Deals that have not moved for longer than this stage allows">
                      <Clock className="h-2.5 w-2.5" />{stalled} stalled
                    </span>
                  )}
                </div>
                {col.kind === 'stage' && (
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--border-subtle)]" title={`${share}% of the weighted pipeline`}>
                    <div className="h-full rounded-full bg-[var(--indigo)] transition-all" style={{ width: `${share}%` }} />
                  </div>
                )}
              </header>
              <div
                onDragOver={(e) => autoScrollY(e.currentTarget, e.clientY)}
                className="flex-1 min-h-0 overflow-y-auto px-2 pb-2"
              >
                {items.map((d, idx) => (
                  <div key={d.id}>
                    {dropHere && over!.index === idx && dragId !== d.id && (
                      <div className="my-1 h-0.5 rounded-full bg-[var(--indigo)]" />
                    )}
                    <DealCard
                      deal={d}
                      next={next.get(d.id)}
                      health={health?.[d.id]}
                      draggable={!dragDisabled}
                      dragging={dragId === d.id}
                      onDragStart={() => { if (!dragDisabled) setDragId(d.id); }}
                      onDragEnd={endDrag}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!dragId) return;
                        const r = e.currentTarget.getBoundingClientRect();
                        const after = e.clientY > r.top + r.height / 2;
                        setOver({ col: col.id, index: after ? idx + 1 : idx });
                      }}
                      onOpen={onOpen}
                    />
                  </div>
                ))}
                {dropHere && over!.index >= items.length && (
                  <div className="my-1 h-0.5 rounded-full bg-[var(--indigo)]" />
                )}
                {items.length === 0 && !dropHere && (
                  col.kind === 'stage' ? (
                    <button
                      type="button"
                      onClick={() => onAddToColumn(col)}
                      className="mt-1 w-full rounded-xl border border-dashed border-[var(--border-default)] py-5 text-caption text-[var(--text-tertiary)] transition-colors hover:border-[var(--indigo)] hover:text-[var(--indigo-text)]"
                    >
                      Drop a deal here, or add one
                    </button>
                  ) : (
                    <p className="py-4 text-center text-caption text-[var(--text-tertiary)]">Nothing here yet</p>
                  )
                )}
              </div>
            </section>
          );
        })}
      </div>

      {/* While a card is in the air: drop it on how it ended. Asked why
          before it is saved, and a delete waits behind the undo bar. */}
      {dragId && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex gap-2 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-2 shadow-[var(--shadow-xl)]">
            {([
              ['lost', 'Lost', XCircle, 'border-rose-500/40 text-rose-600 dark:text-rose-400', 'bg-rose-500 text-white border-rose-500'],
              ['won', 'Won', Trophy, 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400', 'bg-emerald-500 text-white border-emerald-500'],
              ['delete', 'Delete', Trash2, 'border-[var(--border-default)] text-[var(--text-secondary)]', 'bg-[var(--text-primary)] text-[var(--bg-surface)] border-[var(--text-primary)]'],
            ] as const).map(([id, label, Icon, idle, hot]) => (
              <div
                key={id}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setZone(id); setOver(null); }}
                onDragLeave={() => setZone((z) => (z === id ? null : z))}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dropOnZone(id); }}
                className={cn(
                  'flex h-14 w-32 items-center justify-center gap-2 rounded-xl border-2 border-dashed text-strong font-semibold transition-all sm:w-40',
                  zone === id ? cn(hot, 'scale-105 border-solid') : idle,
                )}
              >
                <Icon className="h-4 w-4" /> {label}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/* ─── Pipeline switcher ───────────────────────────── */
function PipelineSwitcher({
  pipelines, active, counts, ready, onPick, onEdit, onNew,
}: {
  pipelines: Pipeline[];
  active: Pipeline | null;
  counts: Record<string, { n: number; value: number }>;
  ready: boolean;
  onPick: (id: string) => void;
  onEdit: () => void;
  onNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { triggerProps, panelProps } = usePopover(open, () => setOpen(false));
  const wrap = useRef<HTMLDivElement>(null);
  // A click anywhere else puts it away.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        {...triggerProps}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-strong font-semibold text-[var(--text-primary)] shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--text-tertiary)]"
      >
        <Layers className="h-3.5 w-3.5 text-[var(--indigo-text)]" />
        <span className="max-w-[200px] truncate">{active?.name || 'Pipeline'}</span>
        <ChevronDown className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
      </button>
      {open && (
        <div {...panelProps} className="absolute left-0 top-full z-30 mt-1.5 w-72 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-1.5 shadow-[var(--shadow-lg)]">
          <p className="px-2 pb-1 pt-0.5 text-micro font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">Pipelines</p>
          {pipelines.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { onPick(p.id); setOpen(false); }}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-hover)]',
                p.id === active?.id && 'bg-[var(--indigo-subtle)]',
              )}
            >
              <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                {p.id === active?.id && <Check className="h-3.5 w-3.5 text-[var(--indigo-text)]" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-body font-medium text-[var(--text-primary)]">
                  <span className="truncate">{p.name}</span>
                  {p.is_default && pipelines.length > 1 && <Star className="h-3 w-3 flex-shrink-0 fill-current text-amber-500" aria-label="Default" />}
                </span>
                <span className="block text-caption text-[var(--text-tertiary)]">
                  {p.stages.length} stages · {counts[p.id]?.n || 0} open · {fmtMoney(counts[p.id]?.value || 0)}
                </span>
              </span>
            </button>
          ))}
          <div className="my-1 h-px bg-[var(--border-subtle)]" />
          {ready ? (
            <>
              <button type="button" onClick={() => { setOpen(false); onEdit(); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-body font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
                <Settings2 className="h-3.5 w-3.5" /> Edit stages of {active?.name}
              </button>
              <button type="button" onClick={() => { setOpen(false); onNew(); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-body font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
                <Plus className="h-3.5 w-3.5" /> New pipeline
              </button>
            </>
          ) : (
            <p className="px-2 py-1.5 text-caption text-[var(--text-tertiary)]">
              Your own pipelines and stage names switch on after the latest database update is applied.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Page ────────────────────────────────────────── */
export function DealsPage() {
  const [dealModal, setDealModal] = useState<Partial<Deal> | null | undefined>(undefined);
  /* ?new=1 opens the new-deal form: "New deal" from Create or Cmd+K lands
     on the form, not on the pipeline with the button still to find. */
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    setDealModal(null);
    setSearchParams((prev) => { const next = new URLSearchParams(prev); next.delete('new'); return next; }, { replace: true });
  }, [searchParams, setSearchParams]);
  const [taskModal, setTaskModal] = useState<Partial<CrmTask> | null | undefined>(undefined);
  const [eventModal, setEventModal] = useState<Partial<CrmEvent> | null | undefined>(undefined);
  const [query, setQuery] = useState('');

  /* The view and the pipeline survive a reload: somebody who works in the
     table does not want to be put back on a board every morning. */
  const [view, setView] = useState<DealView>(() => {
    try { return (localStorage.getItem('deals.view') as DealView) || 'board'; } catch { return 'board'; }
  });
  const setViewPersisted = (v: DealView) => {
    setView(v);
    try { localStorage.setItem('deals.view', v); } catch { /* private window; not worth failing over */ }
  };
  const [pipelineId, setPipelineId] = useState<string | null>(() => {
    try { return localStorage.getItem('deals.pipeline'); } catch { return null; }
  });
  const pickPipeline = (id: string) => {
    setPipelineId(id);
    try { localStorage.setItem('deals.pipeline', id); } catch { /* as above */ }
  };
  const [editor, setEditor] = useState<'edit' | 'new' | null>(null);

  const [filters, setFilters] = useState<DealFilterState>(EMPTY_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>('value');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [outcome, setOutcome] = useState<{ deal: Deal; stage: 'won' | 'lost' } | null>(null);
  const [bulkOutcome, setBulkOutcome] = useState<{ ids: string[]; stage: 'won' | 'lost' } | null>(null);

  const qc = useQueryClient();
  const { openPeek } = usePeek();
  const navigate = useNavigate();
  const pipes = usePipelines();
  const { data: health } = useDealHealth();

  const dealsQ = useQuery({ queryKey: ['crm', 'deals'], queryFn: () => crmApi.listDeals() });
  const tasksQ = useQuery({ queryKey: ['crm', 'tasks'], queryFn: () => crmApi.listTasks() });
  const eventsQ = useQuery({ queryKey: ['crm', 'events'], queryFn: () => crmApi.listEvents() });

  const gone = usePendingRemoval();
  const deals = useMemo(
    () => (dealsQ.data || []).filter((d) => !gone.hidden(d.id)),
    [dealsQ.data, gone],
  );
  const next = useMemo(() => nextStepsByDeal(tasksQ.data || [], eventsQ.data || []), [tasksQ.data, eventsQ.data]);

  const active = (pipelineId && pipes.pipelines.find((p) => p.id === pipelineId)) || pipes.defaultPipeline;
  const inPipeline = useMemo(
    () => deals.filter((d) => pipes.pipelineOf(d)?.id === active?.id),
    [deals, pipes, active],
  );

  /** Which board column a deal sits in: its named stage, or how it ended. */
  const columnOf = (d: Deal): string =>
    d.stage === 'won' || d.stage === 'lost' ? d.stage : pipes.stageOf(d)?.id || d.stage;

  const columns: BoardColumn[] = useMemo(() => {
    const stageCols: BoardColumn[] = (active?.stages || []).map((s) => ({
      id: s.id, name: s.name, kind: 'stage', phase: s.phase,
      probability: s.probability ?? STAGE_PROBABILITY[s.phase],
    }));
    return [
      ...stageCols,
      { id: 'won', name: 'Won', kind: 'won', phase: 'won', probability: 100 },
      { id: 'lost', name: 'Lost', kind: 'lost', phase: 'lost', probability: 0 },
    ];
  }, [active]);

  const visibleDeals = useMemo(
    () => applyDealFilters(inPipeline, filters, query, columnOf),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inPipeline, filters, query, pipes],
  );
  /* Columns follow what is on the board. Won and lost only ever grow, and a
     board that always showed them would spend its width on history while
     the default filter is open deals. */
  const boardColumns = columns.filter((c) => c.kind === 'stage' || visibleDeals.some((d) => d.stage === c.kind));

  const pipelineCounts = useMemo(() => {
    const out: Record<string, { n: number; value: number }> = {};
    for (const d of deals) {
      if (!isOpen(d.stage)) continue;
      const id = pipes.pipelineOf(d)?.id;
      if (!id) continue;
      out[id] = out[id] || { n: 0, value: 0 };
      out[id].n += 1;
      out[id].value += Number(d.value) || 0;
    }
    return out;
  }, [deals, pipes]);

  const stageDealCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const d of inPipeline) if (d.stage_id) out[d.stage_id] = (out[d.stage_id] || 0) + 1;
    return out;
  }, [inPipeline]);

  // Selection is keyed by id, and ids leave the page when a filter changes.
  // Left alone, a bulk action would apply to deals nobody can see.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const alive = new Set(visibleDeals.map((d) => d.id));
      const kept = new Set([...prev].filter((id) => alive.has(id)));
      return kept.size === prev.size ? prev : kept;
    });
  }, [visibleDeals]);

  const loading = dealsQ.isLoading || tasksQ.isLoading || eventsQ.isLoading || pipes.loading;

  const refresh = () => qc.invalidateQueries({ queryKey: ['crm'] });

  /** What one deal's move to `target` (a stage id, 'won' or 'lost') writes. */
  const movePayload = (target: string, reason?: string | null) => {
    if (target === 'won' || target === 'lost') {
      return { stage: target as DealStage, ...(reason !== undefined ? { outcome_reason: reason } : {}) };
    }
    const st = pipes.stageById.get(target);
    return { stage: (st?.phase || target) as DealStage, stage_id: target };
  };
  const targetName = (target: string) =>
    target === 'won' ? 'Won' : target === 'lost' ? 'Lost' : pipes.stageById.get(target)?.name || dealStageLabel(target);

  /**
   * Move a deal, asking why when the move ends it.
   *
   * Every stage change on the page funnels through here - the board's drop
   * zones, the table's dropdown - so the reason is asked once and in one
   * place rather than at whichever entry point somebody remembered.
   */
  const moveStage = async (deal: Deal, target: string, reason?: string | null) => {
    if (target === columnOf(deal)) return;
    if ((target === 'won' || target === 'lost') && reason === undefined) {
      setOutcome({ deal, stage: target });
      return;
    }
    try {
      await crmApi.updateDeal(deal.id, movePayload(target, reason));
      refresh();
      toast.success(
        target === 'won' ? `“${deal.title}” marked won`
          : target === 'lost' ? `“${deal.title}” marked lost`
            : `Moved to ${targetName(target)}`,
      );
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Could not move that deal');
      refresh();
    }
  };

  // Same gate as moveStage: a bulk move into won/lost asks for the reason
  // once for the whole batch.
  const bulkStage = async (target: string, idsOverride?: string[], reason?: string | null) => {
    const ids = idsOverride ?? [...selected];
    if (ids.length === 0) return;
    if ((target === 'won' || target === 'lost') && reason === undefined) {
      setBulkOutcome({ ids, stage: target });
      return;
    }
    // allSettled, not all: one failing update shouldn't report the whole
    // batch as failed and strand the selection on deals that already moved.
    const results = await Promise.allSettled(ids.map((id) => crmApi.updateDeal(id, movePayload(target, reason))));
    const failedCount = results.filter((r) => r.status === 'rejected').length;
    setSelected(new Set());
    refresh();
    if (failedCount === 0) {
      toast.success(`${ids.length} deal${ids.length === 1 ? '' : 's'} moved to ${targetName(target)}`);
    } else if (failedCount === ids.length) {
      toast.error('Could not move those deals');
    } else {
      toast.error(`${failedCount} of ${ids.length} deal${ids.length === 1 ? '' : 's'} failed to move`);
    }
  };

  const bulkDelete = () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setSelected(new Set());
    gone.removeMany(ids, `Deleted ${ids.length} deal${ids.length === 1 ? '' : 's'}`, async () => {
      // allSettled, not all: one failing delete shouldn't report the whole
      // batch as failed. Throwing puts every row back; the refetch then
      // drops the ones that did go.
      const results = await Promise.allSettled(ids.map((id) => crmApi.deleteDeal(id)));
      refresh();
      const failedCount = results.filter((r) => r.status === 'rejected').length;
      if (failedCount > 0) {
        throw new Error(failedCount === ids.length
          ? 'Could not delete those deals'
          : `${failedCount} of ${ids.length} deal${ids.length === 1 ? '' : 's'} failed to delete`);
      }
    });
  };

  // Dropped on Delete while dragging: gone at once, back with one click.
  const deleteOne = (d: Deal) => {
    gone.remove(d.id, `Deleted "${d.title}"`, async () => {
      await crmApi.deleteDeal(d.id);
      refresh();
      qc.invalidateQueries({ queryKey: ['contact-crm'] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
    });
  };

  const openCompany = (d: Deal) => {
    const id = dealCompanyId(d);
    if (id) openPeek('company', id);
    else if (d.company) navigate(`/companies?q=${encodeURIComponent(d.company)}`);
  };
  const openLead = (d: Deal) => {
    const id = leadId(d);
    if (id) openPeek('contact', id);
  };

  const onSort = (key: SortKey) => {
    if (key === sortKey) { setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); return; }
    setSortKey(key);
    // Money and dates are almost always wanted biggest-or-soonest first;
    // names are wanted alphabetically.
    setSortDir(key === 'title' || key === 'company' || key === 'lead' ? 'asc' : 'desc');
  };

  const openDeals = inPipeline.filter((d) => isOpen(d.stage));
  const noNextStep = openDeals.filter((d) => !next.has(d.id)).length;
  const lateNextStep = openDeals.filter((d) => (next.get(d.id)?.dayDiff ?? 0) < 0).length;

  // The forecast reads banked revenue too, so "open" there also shows won.
  const forecastDeals = useMemo(
    () => applyDealFilters(inPipeline, { ...filters, focus: filters.focus === 'open' ? 'all' : filters.focus }, query, columnOf),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inPipeline, filters, query, pipes],
  );

  return (
    <div>
      <PageHeader
        icon={Handshake}
        title="Deals"
        description="Every opportunity, from the first yes to signed."
        actions={
          // Wraps on a phone: the search takes its own line and the buttons sit under it.
          <>
            <SearchInput value={query} onChange={setQuery} placeholder="Search deals, companies, contacts…" className="w-full sm:w-72" />
            {deals.length > 0 && (
              <Button variant="secondary" onClick={() => navigate('/deals/insights')} title="Where deals die, why, and which sources are worth working">
                <BarChart3 className="h-4 w-4" /> Win / loss
              </Button>
            )}
            {deals.length > 0 && (
              <Button variant="secondary" onClick={() => exportDealsCsv(visibleDeals, pipes.stageLabel, (d) => pipes.pipelineOf(d)?.name || '')} title="Export the deals shown below as a CSV file">
                <Download className="h-4 w-4" /> Export CSV
              </Button>
            )}
            <Button variant="primary" onClick={() => setDealModal(active && pipes.ready ? { pipeline_id: active.id, stage_id: active.stages[0]?.id, stage: active.stages[0]?.phase } : null)}><Plus className="h-4 w-4" /> New deal</Button>
          </>
        }
      />

      {/* Which pipeline, and the two things that most often go wrong in it. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <PipelineSwitcher
          pipelines={pipes.pipelines}
          active={active}
          counts={pipelineCounts}
          ready={pipes.ready}
          onPick={pickPipeline}
          onEdit={() => setEditor('edit')}
          onNew={() => setEditor('new')}
        />
        {pipes.ready && (
          <Button variant="secondary" onClick={() => setEditor('edit')} title="Rename, add, reorder or remove stages">
            <Settings2 className="h-4 w-4" /> <span className="hidden sm:inline">Edit stages</span>
          </Button>
        )}
        <span className="flex-1" />
        {openDeals.length > 0 && (noNextStep > 0 || lateNextStep > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 text-caption">
            {lateNextStep > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-1 font-semibold text-rose-600 dark:text-rose-400">
                <Clock className="h-3 w-3" /> {lateNextStep} late next step{lateNextStep === 1 ? '' : 's'}
              </span>
            )}
            {noNextStep > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-1 font-semibold text-amber-700 dark:text-amber-400" title="Open deals with no task or meeting planned. Use Plan on the card.">
                <AlertTriangle className="h-3 w-3" /> {noNextStep} with no next step
              </span>
            )}
          </div>
        )}
      </div>

      {inPipeline.length > 0 && (
        <PipelineHeader
          deals={inPipeline}
          onShowRotting={() => setFilters({ ...EMPTY_FILTERS, focus: 'stalled' })}
          onShowOverdue={() => setFilters({ ...EMPTY_FILTERS, focus: 'overdue' })}
        />
      )}

      {inPipeline.length > 0 && (
        <DealFilters
          deals={inPipeline}
          filters={filters}
          onChange={setFilters}
          view={view}
          onView={setViewPersisted}
          stageOptions={columns.map((c) => ({ id: c.id, label: c.name }))}
        />
      )}

      {/* Bulk bar. Only present when something is selected, so it costs no
          height the rest of the time. */}
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--indigo)]/25 bg-[var(--indigo-subtle)] px-3 py-2">
          <span className="text-body font-semibold text-[var(--text-primary)]">
            {selected.size} selected
          </span>
          <span className="h-4 w-px bg-[var(--border-default)]" />
          <span className="text-caption text-[var(--text-secondary)]">Move to</span>
          {columns.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => bulkStage(c.id)}
              className="rounded-lg bg-[var(--bg-surface)] px-2 py-1 text-caption font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            >
              {c.name}
            </button>
          ))}
          <span className="flex-1" />
          <button
            type="button"
            onClick={bulkDelete}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-caption font-medium text-rose-600 dark:text-rose-400 transition-colors hover:bg-rose-500/10"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-caption font-medium text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
          >
            Clear
          </button>
        </div>
      )}

      {/* Body */}
      {loading ? (
        <SkeletonList rows={6} />
      ) : deals.length === 0 ? (
        <EmptyBoard icon={Handshake} title="No deals yet" body="Add your first deal to start tracking your pipeline. Deals link to your contacts and companies, so everything about an account sits in one place." action="New deal" onAction={() => setDealModal(null)} />
      ) : inPipeline.length === 0 ? (
        <EmptyBoard icon={Layers} title={`Nothing in ${active?.name || 'this pipeline'} yet`} body="Add a deal here, or move one across from another pipeline on its edit form." action="New deal" onAction={() => setDealModal(active && pipes.ready ? { pipeline_id: active.id, stage_id: active.stages[0]?.id, stage: active.stages[0]?.phase } : null)} />
      ) : visibleDeals.length === 0 && view !== 'forecast' ? (
        <div className="panel py-4">
          <p className="text-center text-strong font-medium text-[var(--text-primary)]">
            {query ? `No deals match “${query}”` : 'Nothing here'}
          </p>
          <p className="mt-1 text-center text-body text-[var(--text-tertiary)]">
            {filters.focus === 'stalled'
              ? 'Nothing has gone quiet. Every open deal has moved recently.'
              : filters.focus === 'overdue'
                ? 'Nothing is past its close date.'
                : 'Try a different filter, or clear the search.'}
          </p>
          <button
            onClick={() => { setQuery(''); setFilters(EMPTY_FILTERS); }}
            className="mt-2 block w-full text-center text-body text-[var(--indigo-text)] hover:underline"
          >
            Reset filters
          </button>
        </div>
      ) : view === 'table' ? (
        <DealTable
          deals={visibleDeals}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          selected={selected}
          onToggle={(id) => setSelected((prev) => {
            const nextSel = new Set(prev);
            if (nextSel.has(id)) nextSel.delete(id); else nextSel.add(id);
            return nextSel;
          })}
          onToggleAll={() => setSelected((prev) =>
            prev.size === visibleDeals.length ? new Set() : new Set(visibleDeals.map((d) => d.id)))}
          onOpen={(d) => navigate(`/deals/${d.id}`)}
          onOpenCompany={openCompany}
          onOpenLead={openLead}
          onStageChange={(d, target) => moveStage(d, target)}
        />
      ) : view === 'forecast' ? (
        <ForecastBoard
          deals={forecastDeals}
          next={next}
          health={health}
          onOpen={(d) => navigate(`/deals/${d.id}`)}
          stageName={pipes.stageLabel}
          dragDisabled={query.trim().length > 0}
        />
      ) : (
        <PipelineBoard
          columns={boardColumns}
          deals={visibleDeals}
          columnOf={columnOf}
          next={next}
          onOpen={(d) => navigate(`/deals/${d.id}`)}
          onOutcome={(d, stage) => moveStage(d, stage)}
          onDelete={deleteOne}
          onAddToColumn={(col) => setDealModal(pipes.ready ? { stage: col.phase, stage_id: col.id, pipeline_id: active?.id } : { stage: col.phase })}
          // Search is the one filter people leave half-typed, so dragging
          // waits until it is cleared. Every other filter reorders safely.
          dragDisabled={query.trim().length > 0}
        />
      )}

      {outcome && (
        <OutcomeDialog
          deal={outcome.deal}
          stage={outcome.stage}
          onCancel={() => setOutcome(null)}
          onConfirm={(reason) => {
            const { deal, stage } = outcome;
            setOutcome(null);
            moveStage(deal, stage, reason);
          }}
        />
      )}

      {bulkOutcome && (
        <OutcomeDialog
          deal={{ title: `${bulkOutcome.ids.length} deal${bulkOutcome.ids.length === 1 ? '' : 's'}` } as Deal}
          stage={bulkOutcome.stage}
          onCancel={() => setBulkOutcome(null)}
          onConfirm={(reason) => {
            const { ids, stage } = bulkOutcome;
            setBulkOutcome(null);
            bulkStage(stage, ids, reason);
          }}
        />
      )}

      {editor && (
        <PipelineEditor
          pipeline={editor === 'edit' ? active : null}
          pipelines={pipes.pipelines}
          dealCounts={stageDealCounts}
          onClose={() => setEditor(null)}
          onSaved={pickPipeline}
        />
      )}
      {dealModal !== undefined && <DealModal deal={dealModal} onClose={() => setDealModal(undefined)} />}
      {taskModal !== undefined && <ActivityModal task={taskModal} onClose={() => setTaskModal(undefined)} />}
      {eventModal !== undefined && <MeetingModal event={eventModal} onClose={() => setEventModal(undefined)} />}
    </div>
  );
}

function EmptyBoard({ icon: Icon, title, body, action, onAction }: { icon: typeof Handshake; title: string; body: string; action: string; onAction: () => void }) {
  return (
    <EmptyState icon={Icon} title={title} description={body} actionLabel={action} onAction={onAction} />
  );
}

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowDown, ArrowUp, Plus, Star, Trash2 } from 'lucide-react';
import { crmApi, type StageDraft } from '../../api/crm.api';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { cn } from '../../lib/utils';
import {
  DEFAULT_PIPELINE_STAGES,
  PHASE_LABEL,
  PIPELINE_PHASES,
  STAGE_PROBABILITY,
  STAGE_ROT_DAYS,
  type Pipeline,
  type PipelinePhase,
} from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Name your stages, order them, give each its odds and its stale limit.

   Each stage also says how far along it counts as (early, qualified or
   late). That is what the forecast, the win/loss report and the automations
   read, so a team can call a stage anything it likes without breaking the
   numbers built on top of it.
   ═══════════════════════════════════════════════════════════════════════ */

type Row = { key: string; id?: string; name: string; phase: PipelinePhase; probability: string; rot_days: string };

let seq = 0;
const nextKey = () => `new-${++seq}`;

function toRows(p: Pipeline | null): Row[] {
  const src = p ? p.stages : DEFAULT_PIPELINE_STAGES.map((s) => ({ ...s, id: undefined as string | undefined }));
  return src.map((s) => ({
    key: s.id || nextKey(),
    id: s.id,
    name: s.name,
    phase: s.phase,
    probability: s.probability == null ? '' : String(s.probability),
    rot_days: s.rot_days == null ? '' : String(s.rot_days),
  }));
}

const fieldCls = 'h-8 w-full rounded-md border border-[var(--border-control)] bg-[var(--bg-app)] px-2 text-body text-[var(--text-primary)] outline-none focus:border-[var(--indigo)] focus-visible:shadow-[var(--ring-focus)]';

export function PipelineEditor({
  pipeline, pipelines, dealCounts, onClose, onSaved,
}: {
  /** Null to create a new pipeline. */
  pipeline: Pipeline | null;
  pipelines: Pipeline[];
  /** Open deals in each stage, so removing a stage can say where they go. */
  dealCounts: Record<string, number>;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const qc = useQueryClient();
  const creating = !pipeline;
  const [name, setName] = useState(pipeline?.name || '');
  const [rows, setRows] = useState<Row[]>(() => toRows(pipeline));
  const [moves, setMoves] = useState<Record<string, string>>({});
  const [makeDefault, setMakeDefault] = useState(false);

  const removed = (pipeline?.stages || []).filter((s) => !rows.some((r) => r.id === s.id));
  const keptExisting = rows.filter((r) => r.id);

  const set = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, by: number) => setRows((rs) => {
    const j = i + by;
    if (j < 0 || j >= rs.length) return rs;
    const next = [...rs];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const drafts = (): StageDraft[] => rows.map((r) => ({
    ...(r.id ? { id: r.id } : {}),
    name: r.name.trim(),
    phase: r.phase,
    probability: r.probability === '' ? null : Number(r.probability),
    rot_days: r.rot_days === '' ? null : Number(r.rot_days),
  }));

  const invalid = !name.trim() || rows.length === 0 || rows.some((r) => !r.name.trim());

  const save = useMutation({
    mutationFn: async () => {
      if (creating) {
        const made = await crmApi.createPipeline({ name: name.trim(), stages: drafts() });
        if (makeDefault) await crmApi.updatePipeline(made.id, { is_default: true });
        return made.id;
      }
      await crmApi.updatePipeline(pipeline!.id, {
        name: name.trim(),
        stages: drafts(),
        moves,
        ...(makeDefault ? { is_default: true } : {}),
      });
      return pipeline!.id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['crm'] });
      toast.success(creating ? 'Pipeline added' : 'Pipeline saved');
      onSaved(id);
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save the pipeline'),
  });

  const others = pipelines.filter((p) => p.id !== pipeline?.id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = useMutation({
    mutationFn: () => crmApi.deletePipeline(pipeline!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm'] });
      toast.success(`Removed ${pipeline!.name}. Its deals moved to ${(others.find((o) => o.is_default) || others[0])?.name}.`);
      onSaved((others.find((o) => o.is_default) || others[0]).id);
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not remove the pipeline'),
  });

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={creating ? 'New pipeline' : 'Edit pipeline'}
      description="Name the stages your deals move through. Each one has its own odds and its own limit before a deal counts as gone quiet."
      size="lg"
      footer={
        <>
          {!creating && others.length > 0 && (
            confirmDelete ? (
              <span className="mr-auto flex items-center gap-2 text-body text-[var(--text-secondary)]">
                Deals move to {(others.find((o) => o.is_default) || others[0]).name}.
                <button type="button" onClick={() => remove.mutate()} className="font-semibold text-rose-600 hover:underline dark:text-rose-400">Remove</button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="text-[var(--text-tertiary)] hover:underline">Keep</button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className="mr-auto flex items-center gap-1.5 text-body font-medium text-rose-600 transition-colors hover:text-rose-700 dark:text-rose-400">
                <Trash2 className="h-3.5 w-3.5" /> Remove pipeline
              </button>
            )
          )}
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="button" disabled={invalid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : creating ? 'Add pipeline' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Input label="Pipeline name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. New business" autoFocus={creating} />
          </div>
          {!pipeline?.is_default && (
            <button
              type="button"
              onClick={() => setMakeDefault((v) => !v)}
              aria-pressed={makeDefault}
              title="New deals land in the default pipeline"
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-body font-medium transition-colors',
                makeDefault ? 'bg-[var(--indigo-subtle)] text-[var(--indigo-text)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
              )}
            >
              <Star className={cn('h-3.5 w-3.5', makeDefault && 'fill-current')} /> Default
            </button>
          )}
        </div>

        <div>
          <div className="mb-1.5 hidden grid-cols-12 gap-2 px-1 text-micro font-semibold uppercase tracking-wide text-[var(--text-tertiary)] sm:grid">
            <span className="col-span-4">Stage</span>
            <span className="col-span-3">Counts as</span>
            <span className="col-span-2">Odds %</span>
            <span className="col-span-2">Stale after</span>
          </div>
          <ol className="space-y-1.5">
            {rows.map((r, i) => (
              <li key={r.key} className="grid grid-cols-12 items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1.5">
                <div className="col-span-12 flex items-center gap-1.5 sm:col-span-4">
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[var(--bg-muted)] text-micro font-semibold tabular-nums text-[var(--text-secondary)]">{i + 1}</span>
                  <input aria-label={`Stage ${i + 1} name`} value={r.name} onChange={(e) => set(r.key, { name: e.target.value })} placeholder="Stage name" className={fieldCls} />
                </div>
                <select aria-label="Counts as" value={r.phase} onChange={(e) => set(r.key, { phase: e.target.value as PipelinePhase })} className={cn(fieldCls, 'col-span-4 cursor-pointer sm:col-span-3')}>
                  {PIPELINE_PHASES.map((p) => <option key={p} value={p}>{PHASE_LABEL[p]}</option>)}
                </select>
                <input aria-label="Odds percent" type="number" min="0" max="100" value={r.probability} onChange={(e) => set(r.key, { probability: e.target.value })} placeholder={String(STAGE_PROBABILITY[r.phase])} className={cn(fieldCls, 'col-span-3 sm:col-span-2')} />
                <input aria-label="Days before stale" type="number" min="1" max="365" value={r.rot_days} onChange={(e) => set(r.key, { rot_days: e.target.value })} placeholder={`${STAGE_ROT_DAYS[r.phase]}d`} className={cn(fieldCls, 'col-span-3 sm:col-span-2')} />
                <div className="col-span-2 flex items-center justify-end gap-0.5 sm:col-span-1">
                  <button type="button" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0} className="icon-btn h-6 w-6 text-[var(--text-tertiary)] disabled:opacity-30"><ArrowUp className="h-3 w-3" /></button>
                  <button type="button" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="icon-btn h-6 w-6 text-[var(--text-tertiary)] disabled:opacity-30"><ArrowDown className="h-3 w-3" /></button>
                  <button
                    type="button"
                    aria-label={`Remove ${r.name || 'stage'}`}
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                    disabled={rows.length === 1}
                    className="icon-btn h-6 w-6 text-[var(--text-tertiary)] hover:text-rose-600 disabled:opacity-30"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={() => setRows((rs) => [...rs, { key: nextKey(), name: '', phase: rs[rs.length - 1]?.phase || 'lead', probability: '', rot_days: '' }])}
            disabled={rows.length >= 20}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-body font-medium text-[var(--indigo-text)] transition-colors hover:bg-[var(--indigo-subtle)] disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" /> Add a stage
          </button>
        </div>

        {removed.length > 0 && keptExisting.length > 0 && (
          <div className="space-y-1.5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-body font-semibold text-[var(--text-primary)]">Where should their deals go?</p>
            {removed.map((s) => (
              <label key={s.id} className="flex flex-wrap items-center gap-2 text-body text-[var(--text-secondary)]">
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-[var(--text-primary)]">{s.name}</span>
                  {' '}has {dealCounts[s.id] || 0} deal{(dealCounts[s.id] || 0) === 1 ? '' : 's'}. Move them to
                </span>
                <select
                  value={moves[s.id] || ''}
                  onChange={(e) => setMoves((m) => ({ ...m, [s.id]: e.target.value }))}
                  className={cn(fieldCls, 'w-44 cursor-pointer')}
                >
                  <option value="">The stage before it</option>
                  {keptExisting.map((k) => <option key={k.id} value={k.id}>{k.name || 'Untitled'}</option>)}
                </select>
              </label>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { GripVertical, Minus, Plus, RotateCcw, Star, Trash2 } from 'lucide-react';
import { crmApi, type StageDraft } from '../../api/crm.api';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
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
   Shape a pipeline the way you would on a whiteboard.

   The stages run across the top exactly as the board will show them, and
   that strip updates as you type. Below, the stages are a list you drag
   into order; pick one and its settings open beside it: what it is called,
   how far along it counts as, its win odds on a slider and how many quiet
   days make a deal in it stalled.
   ═══════════════════════════════════════════════════════════════════════ */

type Row = { key: string; id?: string; name: string; phase: PipelinePhase; probability: number | null; rot_days: number | null };

let seq = 0;
const nextKey = () => `new-${++seq}`;

function toRows(p: Pipeline | null): Row[] {
  const src = p ? p.stages : DEFAULT_PIPELINE_STAGES.map((s) => ({ ...s, id: undefined as string | undefined }));
  return src.map((s) => ({
    key: s.id || nextKey(),
    id: s.id,
    name: s.name,
    phase: s.phase,
    probability: s.probability,
    rot_days: s.rot_days,
  }));
}

const PHASE_HELP: Record<PipelinePhase, string> = {
  lead: 'Not qualified yet. Counts toward pipeline, not commit.',
  qualified: 'A real opportunity. Meetings move deals here automatically.',
  proposal: 'Terms are on the table. Counts toward your commit number.',
};

const PHASE_TONE: Record<PipelinePhase, string> = {
  lead: 'bg-slate-400',
  qualified: 'bg-[var(--indigo)]',
  proposal: 'bg-amber-500',
};

const STALE_PRESETS = [7, 14, 21, 30];

const odds = (r: Row) => r.probability ?? STAGE_PROBABILITY[r.phase];
const stale = (r: Row) => r.rot_days ?? STAGE_ROT_DAYS[r.phase];

export function PipelineEditor({
  pipeline, pipelines, dealCounts, onClose, onSaved,
}: {
  /** Null to create a new pipeline. */
  pipeline: Pipeline | null;
  pipelines: Pipeline[];
  /** Deals in each stage, so removing a stage can say where they go. */
  dealCounts: Record<string, number>;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const qc = useQueryClient();
  const creating = !pipeline;
  const [name, setName] = useState(pipeline?.name || '');
  const [rows, setRows] = useState<Row[]>(() => toRows(pipeline));
  const [selected, setSelected] = useState<string>(() => rows[0]?.key);
  const [moves, setMoves] = useState<Record<string, string>>({});
  const [makeDefault, setMakeDefault] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  const sel = rows.find((r) => r.key === selected) || rows[0];
  const selIndex = rows.findIndex((r) => r.key === sel?.key);
  const removed = (pipeline?.stages || []).filter((s) => !rows.some((r) => r.id === s.id));
  const keptExisting = rows.filter((r) => r.id);

  const set = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const addStage = () => {
    const last = rows[rows.length - 1];
    const row: Row = { key: nextKey(), name: 'New stage', phase: last?.phase || 'lead', probability: null, rot_days: null };
    setRows((rs) => [...rs, row]);
    setSelected(row.key);
  };

  const removeStage = (key: string) => {
    const i = rows.findIndex((r) => r.key === key);
    const nextRows = rows.filter((r) => r.key !== key);
    setRows(nextRows);
    setSelected(nextRows[Math.max(0, i - 1)]?.key);
  };

  const drop = (to: number) => {
    if (!dragKey) return;
    setRows((rs) => {
      const from = rs.findIndex((r) => r.key === dragKey);
      if (from < 0) return rs;
      const next = [...rs];
      const [moving] = next.splice(from, 1);
      next.splice(from < to ? to - 1 : to, 0, moving);
      return next;
    });
    setDragKey(null);
    setDropAt(null);
  };

  const drafts = (): StageDraft[] => rows.map((r) => ({
    ...(r.id ? { id: r.id } : {}),
    name: r.name.trim(),
    phase: r.phase,
    probability: r.probability,
    rot_days: r.rot_days,
  }));

  const problem = !name.trim()
    ? 'Give the pipeline a name'
    : rows.length === 0
      ? 'A pipeline needs at least one stage'
      : rows.some((r) => !r.name.trim())
        ? 'Every stage needs a name'
        : null;

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
  const fallback = others.find((o) => o.is_default) || others[0];
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = useMutation({
    mutationFn: () => crmApi.deletePipeline(pipeline!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm'] });
      toast.success(`Removed ${pipeline!.name}. Its deals moved to ${fallback?.name}.`);
      onSaved(fallback.id);
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not remove the pipeline'),
  });

  // The weighted value a 10,000 deal would carry through each stage: the
  // quickest way to see whether the odds climb the way they should.
  const climbs = useMemo(() => rows.every((r, i) => i === 0 || odds(r) >= odds(rows[i - 1])), [rows]);

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={creating ? 'New pipeline' : `Edit ${pipeline!.name}`}
      size="2xl"
      footer={
        <>
          {!creating && others.length > 0 && (
            confirmDelete ? (
              <span className="mr-auto flex items-center gap-2 text-body text-[var(--text-secondary)]">
                Remove it? Its deals move to {fallback.name}.
                <button type="button" onClick={() => remove.mutate()} className="font-semibold text-rose-600 hover:underline dark:text-rose-400">Remove</button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="text-[var(--text-tertiary)] hover:underline">Keep</button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className="mr-auto flex items-center gap-1.5 text-body font-medium text-[var(--text-tertiary)] transition-colors hover:text-rose-600 dark:hover:text-rose-400">
                <Trash2 className="h-3.5 w-3.5" /> Remove pipeline
              </button>
            )
          )}
          {problem && <span className="text-caption text-[var(--text-tertiary)]">{problem}</span>}
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="button" disabled={!!problem || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : creating ? 'Add pipeline' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Name, as a title rather than a form field. */}
        <div className="flex items-center gap-3">
          <input
            aria-label="Pipeline name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this pipeline, e.g. New business"
            autoFocus={creating}
            className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 -ml-2 text-heading font-semibold text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-tertiary)] hover:border-[var(--border-subtle)] focus:border-[var(--indigo)] focus-visible:shadow-[var(--ring-focus)]"
          />
          {pipeline?.is_default ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-1 text-caption font-semibold text-amber-700 dark:text-amber-400">
              <Star className="h-3 w-3 fill-current" /> Default
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setMakeDefault((v) => !v)}
              aria-pressed={makeDefault}
              title="New deals land in the default pipeline"
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-1 text-caption font-semibold transition-colors',
                makeDefault ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]',
              )}
            >
              <Star className={cn('h-3 w-3', makeDefault && 'fill-current')} /> {makeDefault ? 'Default' : 'Make default'}
            </button>
          )}
        </div>

        {/* Live preview: the board's stages, left to right, as they will look. */}
        <div>
          <p className="mb-2 text-micro font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">How the board will look</p>
          <div className="flex overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-muted)]/40 p-1.5 scrollbar-none">
            {rows.map((r, i) => {
              const on = r.key === sel?.key;
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setSelected(r.key)}
                  style={{
                    clipPath: i === 0
                      ? 'polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%)'
                      : 'polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%, 10px 50%)',
                  }}
                  className={cn(
                    'relative -ml-1 min-w-28 flex-1 py-2 pl-5 pr-4 text-left transition-colors first:ml-0 first:pl-3',
                    on ? 'bg-[var(--indigo)] text-white' : 'bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
                  )}
                >
                  <span className="block truncate text-body font-semibold">{r.name || 'Untitled'}</span>
                  <span className={cn('block text-micro tabular-nums', on ? 'text-white/80' : 'text-[var(--text-tertiary)]')}>
                    {odds(r)}% · stalls after {stale(r)}d
                  </span>
                </button>
              );
            })}
          </div>
          {!climbs && (
            <p className="mt-1.5 text-caption text-amber-700 dark:text-amber-400">
              Odds go down somewhere along the way. Later stages usually close more often than earlier ones.
            </p>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-5">
          {/* The stages, in order. Drag to reorder, click to edit. */}
          <div className="md:col-span-2">
            <p className="mb-2 text-micro font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">Stages · drag to reorder</p>
            <ol
              className="space-y-1"
              onDragOver={(e) => { e.preventDefault(); if (dropAt === null) setDropAt(rows.length); }}
              onDrop={(e) => { e.preventDefault(); drop(dropAt ?? rows.length); }}
            >
              {rows.map((r, i) => {
                const on = r.key === sel?.key;
                return (
                  <li key={r.key}>
                    {dragKey && dropAt === i && <div className="mb-1 h-0.5 rounded-full bg-[var(--indigo)]" />}
                    <div
                      draggable
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragKey(r.key); }}
                      onDragEnd={() => { setDragKey(null); setDropAt(null); }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const box = e.currentTarget.getBoundingClientRect();
                        setDropAt(e.clientY > box.top + box.height / 2 ? i + 1 : i);
                      }}
                      onClick={() => setSelected(r.key)}
                      className={cn(
                        'group flex cursor-pointer items-center gap-2 rounded-xl border px-2 py-2 transition-all',
                        on
                          ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)] shadow-[var(--shadow-sm)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-default)]',
                        dragKey === r.key && 'opacity-40',
                      )}
                    >
                      <GripVertical aria-hidden="true" className="h-4 w-4 flex-shrink-0 cursor-grab text-[var(--text-tertiary)] opacity-60 group-hover:opacity-100" />
                      <span className={cn('h-2 w-2 flex-shrink-0 rounded-full', PHASE_TONE[r.phase])} title={PHASE_LABEL[r.phase]} />
                      <span className="min-w-0 flex-1 truncate text-body font-semibold text-[var(--text-primary)]">{r.name || 'Untitled'}</span>
                      <span className="flex-shrink-0 text-micro tabular-nums text-[var(--text-tertiary)]">{odds(r)}%</span>
                      {r.id && (dealCounts[r.id] || 0) > 0 && (
                        <span className="flex-shrink-0 rounded-full bg-[var(--bg-muted)] px-1.5 text-micro font-semibold tabular-nums text-[var(--text-secondary)]" title="Deals in this stage">
                          {dealCounts[r.id]}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
              {dragKey && dropAt === rows.length && <li className="h-0.5 rounded-full bg-[var(--indigo)]" />}
            </ol>
            <button
              type="button"
              onClick={addStage}
              disabled={rows.length >= 20}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--border-default)] py-2 text-body font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--indigo)] hover:text-[var(--indigo-text)] disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Add a stage
            </button>
          </div>

          {/* The chosen stage's settings. */}
          {sel && (
            <div className="space-y-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 md:col-span-3">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[var(--indigo-subtle)] text-caption font-semibold tabular-nums text-[var(--indigo-text)]">{selIndex + 1}</span>
                <input
                  aria-label="Stage name"
                  value={sel.name}
                  onChange={(e) => set(sel.key, { name: e.target.value })}
                  placeholder="Stage name"
                  className="min-w-0 flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2.5 py-1.5 text-strong font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--indigo)] focus-visible:shadow-[var(--ring-focus)]"
                />
                <button
                  type="button"
                  onClick={() => removeStage(sel.key)}
                  disabled={rows.length === 1}
                  title={rows.length === 1 ? 'A pipeline needs at least one stage' : 'Remove this stage'}
                  className="icon-btn h-8 w-8 text-[var(--text-tertiary)] hover:text-rose-600 disabled:opacity-30"
                  aria-label="Remove this stage"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div>
                <p className="mb-1.5 text-body font-medium text-[var(--text-secondary)]">How far along this counts</p>
                <div className="grid grid-cols-3 gap-1 rounded-xl bg-[var(--bg-muted)] p-1">
                  {PIPELINE_PHASES.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => set(sel.key, { phase: p })}
                      aria-pressed={sel.phase === p}
                      className={cn(
                        'flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-body font-semibold transition-all',
                        sel.phase === p ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
                      )}
                    >
                      <span className={cn('h-1.5 w-1.5 rounded-full', PHASE_TONE[p])} />{PHASE_LABEL[p]}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-caption text-[var(--text-tertiary)]">{PHASE_HELP[sel.phase]}</p>
              </div>

              <div>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <p className="text-body font-medium text-[var(--text-secondary)]">Win odds</p>
                  <span className="flex items-baseline gap-2">
                    {sel.probability !== null && sel.probability !== STAGE_PROBABILITY[sel.phase] && (
                      <button type="button" onClick={() => set(sel.key, { probability: null })} className="inline-flex items-center gap-1 text-caption text-[var(--text-tertiary)] hover:text-[var(--indigo-text)]">
                        <RotateCcw className="h-3 w-3" /> Default {STAGE_PROBABILITY[sel.phase]}%
                      </button>
                    )}
                    <span className="text-heading font-semibold tabular-nums text-[var(--text-primary)]">{odds(sel)}%</span>
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  aria-label="Win odds"
                  value={odds(sel)}
                  onChange={(e) => set(sel.key, { probability: Number(e.target.value) })}
                  className="w-full cursor-pointer accent-[var(--indigo)]"
                />
                <p className="mt-1 text-caption text-[var(--text-tertiary)]">
                  A $10,000 deal here adds <span className="font-semibold tabular-nums text-[var(--text-secondary)]">${(odds(sel) * 100).toLocaleString()}</span> to the forecast.
                </p>
              </div>

              <div>
                <p className="mb-1.5 text-body font-medium text-[var(--text-secondary)]">Flag a deal as stalled after</p>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)]">
                    <button type="button" aria-label="One day fewer" onClick={() => set(sel.key, { rot_days: Math.max(1, stale(sel) - 1) })} className="icon-btn h-8 w-8 text-[var(--text-secondary)]"><Minus className="h-3.5 w-3.5" /></button>
                    <span className="w-16 text-center text-strong font-semibold tabular-nums text-[var(--text-primary)]">{stale(sel)} days</span>
                    <button type="button" aria-label="One day more" onClick={() => set(sel.key, { rot_days: Math.min(365, stale(sel) + 1) })} className="icon-btn h-8 w-8 text-[var(--text-secondary)]"><Plus className="h-3.5 w-3.5" /></button>
                  </div>
                  {STALE_PRESETS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => set(sel.key, { rot_days: d })}
                      className={cn(
                        'rounded-full px-2.5 py-1 text-caption font-semibold tabular-nums transition-colors',
                        stale(sel) === d ? 'bg-[var(--indigo)] text-white' : 'bg-[var(--bg-muted)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
                      )}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-caption text-[var(--text-tertiary)]">With no movement for this long, the card turns red and counts as stalled.</p>
              </div>
            </div>
          )}
        </div>

        {removed.length > 0 && keptExisting.length > 0 && (
          <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-body font-semibold text-[var(--text-primary)]">Removing {removed.length === 1 ? 'a stage' : `${removed.length} stages`}. Where should the deals go?</p>
            {removed.map((s) => (
              <label key={s.id} className="flex flex-wrap items-center gap-2 text-body text-[var(--text-secondary)]">
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-[var(--text-primary)]">{s.name}</span>
                  {' '}has {dealCounts[s.id] || 0} deal{(dealCounts[s.id] || 0) === 1 ? '' : 's'}
                </span>
                <select
                  value={moves[s.id] || ''}
                  onChange={(e) => setMoves((m) => ({ ...m, [s.id]: e.target.value }))}
                  className="h-8 w-48 cursor-pointer rounded-md border border-[var(--border-control)] bg-[var(--bg-app)] px-2 text-body text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
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

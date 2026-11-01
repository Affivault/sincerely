import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Check, ChevronDown, ChevronUp, Copy, GripVertical, ListChecks, Minus, Plus, RotateCcw, Star, Trash2, X,
} from 'lucide-react';
import { crmApi, type StageDraft } from '../../api/crm.api';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';
import { STAGE_COLOR_LABEL, STAGE_TONE } from '../../lib/stageColors';
import { usePipelines } from '../../hooks/usePipelines';
import {
  PHASE_LABEL,
  PIPELINE_PHASES,
  PIPELINE_TEMPLATES,
  STAGE_CHECKLIST_MAX,
  STAGE_CHECK_MAX_LENGTH,
  STAGE_COLORS,
  STAGE_DESCRIPTION_MAX_LENGTH,
  STAGE_PROBABILITY,
  STAGE_ROT_DAYS,
  stageColor,
  type Pipeline,
  type PipelinePhase,
  type StageColor,
  type StageTemplate,
} from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Shape a pipeline the way you would on a whiteboard.

   The stages run across the top exactly as the board will show them, in
   their colours, and that strip updates as you type. Below, the stages are
   a list you drag (or Alt+arrow) into order; pick one and its settings open
   beside it: name, colour, how far along it counts, win odds, when a deal
   in it is stalled, what is true of a deal there, and the checklist a rep
   works through before moving it on.

   A new pipeline starts from a template, so nobody faces an empty screen.
   ═══════════════════════════════════════════════════════════════════════ */

type Row = {
  key: string;
  id?: string;
  name: string;
  phase: PipelinePhase;
  probability: number | null;
  rot_days: number | null;
  color: StageColor | null;
  description: string;
  checklist: string[];
};

let seq = 0;
const nextKey = () => `new-${++seq}`;

function fromTemplate(stages: StageTemplate[]): Row[] {
  return stages.map((s) => ({
    key: nextKey(),
    name: s.name,
    phase: s.phase,
    probability: s.probability,
    rot_days: s.rot_days,
    color: s.color ?? null,
    description: s.description || '',
    checklist: [...(s.checklist || [])],
  }));
}

function toRows(p: Pipeline | null): Row[] {
  if (!p) return fromTemplate(PIPELINE_TEMPLATES[0].stages);
  return p.stages.map((s, i) => ({
    key: s.id,
    id: s.id,
    name: s.name,
    phase: s.phase,
    probability: s.probability,
    rot_days: s.rot_days,
    // Pin the colour it shows today, so reordering does not repaint it.
    color: stageColor(s, i),
    description: s.description || '',
    checklist: [...(s.checklist || [])],
  }));
}

const PHASE_HELP: Record<PipelinePhase, string> = {
  lead: 'Not qualified yet. Counts toward pipeline, not commit.',
  qualified: 'A real opportunity. Meetings move deals here automatically.',
  proposal: 'Terms are on the table. Counts toward your commit number.',
};

const STALE_PRESETS = [7, 14, 21, 30];

const odds = (r: Row) => r.probability ?? STAGE_PROBABILITY[r.phase];
const stale = (r: Row) => r.rot_days ?? STAGE_ROT_DAYS[r.phase];
const colorOf = (r: Row, i: number) => stageColor(r, i);

const label = 'mb-1.5 text-body font-medium text-[var(--text-secondary)]';
const sectionTitle = 'mb-2 text-micro font-semibold uppercase tracking-wide text-[var(--text-tertiary)]';

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
  const { styled } = usePipelines();
  const creating = !pipeline;
  const [name, setName] = useState(pipeline?.name || PIPELINE_TEMPLATES[0].name);
  const [template, setTemplate] = useState<string>(PIPELINE_TEMPLATES[0].id);
  const [rows, setRows] = useState<Row[]>(() => toRows(pipeline));
  const [selected, setSelected] = useState<string>(() => rows[0]?.key);
  const [moves, setMoves] = useState<Record<string, string>>({});
  const [makeDefault, setMakeDefault] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [newCheck, setNewCheck] = useState('');

  const selIndex = Math.max(0, rows.findIndex((r) => r.key === selected));
  const sel = rows[selIndex];
  const removed = (pipeline?.stages || []).filter((s) => !rows.some((r) => r.id === s.id));
  const keptExisting = rows.filter((r) => r.id);

  const set = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const pick = (key: string | undefined) => { if (key) { setSelected(key); setNewCheck(''); } };

  const applyTemplate = (id: string) => {
    const t = PIPELINE_TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    const prev = PIPELINE_TEMPLATES.find((x) => x.id === template);
    // Keep a name the user typed; swap one the last template filled in.
    if (!name.trim() || name === prev?.name) setName(t.id === 'blank' ? '' : t.name);
    const next = fromTemplate(t.stages);
    setTemplate(id);
    setRows(next);
    pick(next[0]?.key);
  };

  const addStage = () => {
    const last = rows[rows.length - 1];
    const used = new Set(rows.map((r, i) => colorOf(r, i)));
    const row: Row = {
      key: nextKey(), name: 'New stage', phase: last?.phase || 'lead', probability: null, rot_days: null,
      color: STAGE_COLORS.find((c) => !used.has(c)) || null, description: '', checklist: [],
    };
    setRows((rs) => [...rs, row]);
    pick(row.key);
  };

  const duplicateStage = (key: string) => {
    const i = rows.findIndex((r) => r.key === key);
    if (i < 0 || rows.length >= 20) return;
    const copy: Row = { ...rows[i], key: nextKey(), id: undefined, name: `${rows[i].name} (copy)`, checklist: [...rows[i].checklist] };
    setRows((rs) => [...rs.slice(0, i + 1), copy, ...rs.slice(i + 1)]);
    pick(copy.key);
  };

  const removeStage = (key: string) => {
    const i = rows.findIndex((r) => r.key === key);
    const nextRows = rows.filter((r) => r.key !== key);
    setRows(nextRows);
    pick(nextRows[Math.max(0, i - 1)]?.key);
  };

  const shift = (key: string, by: -1 | 1) => {
    setRows((rs) => {
      const from = rs.findIndex((r) => r.key === key);
      const to = from + by;
      if (from < 0 || to < 0 || to >= rs.length) return rs;
      const next = [...rs];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
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

  const addCheck = () => {
    const t = newCheck.trim().slice(0, STAGE_CHECK_MAX_LENGTH);
    if (!sel || !t || sel.checklist.includes(t) || sel.checklist.length >= STAGE_CHECKLIST_MAX) return;
    set(sel.key, { checklist: [...sel.checklist, t] });
    setNewCheck('');
  };

  const drafts = (keepIds = true): StageDraft[] => rows.map((r, i) => ({
    ...(keepIds && r.id ? { id: r.id } : {}),
    name: r.name.trim(),
    phase: r.phase,
    probability: r.probability,
    rot_days: r.rot_days,
    ...(styled ? {
      color: colorOf(r, i),
      description: r.description.trim() || null,
      checklist: r.checklist,
    } : {}),
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

  // A copy with the stages as they are on screen, deals stay where they are.
  const duplicate = useMutation({
    mutationFn: () => crmApi.createPipeline({ name: `${name.trim() || pipeline!.name} (copy)`.slice(0, 60), stages: drafts(false) }),
    onSuccess: (made) => {
      qc.invalidateQueries({ queryKey: ['crm'] });
      toast.success(`Made ${made.name}`);
      onSaved(made.id);
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not copy the pipeline'),
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

  const climbs = useMemo(() => rows.every((r, i) => i === 0 || odds(r) >= odds(rows[i - 1])), [rows]);
  const busy = save.isPending || duplicate.isPending || remove.isPending;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={creating ? 'New pipeline' : `Edit ${pipeline!.name}`}
      size="2xl"
      footer={
        <>
          {!creating && (
            confirmDelete ? (
              <span className="mr-auto flex items-center gap-2 text-body text-[var(--text-secondary)]">
                Remove it? Its deals move to {fallback?.name}.
                <button type="button" onClick={() => remove.mutate()} className="font-semibold text-rose-600 hover:underline dark:text-rose-400">Remove</button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="text-[var(--text-tertiary)] hover:underline">Keep</button>
              </span>
            ) : (
              <span className="mr-auto flex items-center gap-3">
                {others.length > 0 && (
                  <button type="button" onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 text-body font-medium text-[var(--text-tertiary)] transition-colors hover:text-rose-600 dark:hover:text-rose-400">
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </button>
                )}
                <button
                  type="button"
                  disabled={!!problem || busy || pipelines.length >= 20}
                  onClick={() => duplicate.mutate()}
                  title="A new pipeline with these stages. Deals stay where they are."
                  className="flex items-center gap-1.5 text-body font-medium text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-50"
                >
                  <Copy className="h-3.5 w-3.5" /> Duplicate
                </button>
              </span>
            )
          )}
          {problem && <span className="text-caption text-[var(--text-tertiary)]">{problem}</span>}
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="button" disabled={!!problem || busy} onClick={() => save.mutate()}>
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
            maxLength={60}
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

        {/* A new pipeline starts from a shape that already works. */}
        {creating && (
          <div>
            <p className={sectionTitle}>Start from</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {PIPELINE_TEMPLATES.map((t) => {
                const on = template === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => applyTemplate(t.id)}
                    aria-pressed={on}
                    className={cn(
                      'rounded-xl border p-2.5 text-left transition-all',
                      on ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)] shadow-[var(--shadow-sm)]' : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-default)]',
                    )}
                  >
                    <span className="flex gap-0.5">
                      {t.stages.map((s, i) => <span key={i} className={cn('h-1.5 flex-1 rounded-full', STAGE_TONE[stageColor(s, i)].dot)} />)}
                    </span>
                    <span className="mt-2 block truncate text-body font-semibold text-[var(--text-primary)]">{t.name}</span>
                    <span className="block truncate text-micro text-[var(--text-tertiary)]">{t.blurb}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Live preview: the board's stages, left to right, as they will look. */}
        <div>
          <p className={sectionTitle}>How the board will look</p>
          <div className="flex gap-1.5 overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-muted)]/40 p-1.5 scrollbar-none">
            {rows.map((r, i) => {
              const on = r.key === sel?.key;
              const tone = STAGE_TONE[colorOf(r, i)];
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => pick(r.key)}
                  className={cn(
                    'min-w-28 flex-1 overflow-hidden rounded-lg border-t-4 bg-[var(--bg-surface)] px-3 py-2 text-left shadow-[var(--shadow-sm)] transition-all',
                    tone.border,
                    on ? 'ring-2 ring-[var(--indigo)]' : 'hover:bg-[var(--bg-hover)]',
                  )}
                >
                  <span className="block truncate text-body font-semibold text-[var(--text-primary)]">{r.name || 'Untitled'}</span>
                  <span className="block text-micro tabular-nums text-[var(--text-tertiary)]">
                    {odds(r)}% · stalls after {stale(r)}d
                  </span>
                  {styled && r.checklist.length > 0 && (
                    <span className={cn('mt-1 inline-flex items-center gap-1 text-micro font-medium', tone.text)}>
                      <ListChecks className="h-3 w-3" />{r.checklist.length} to do
                    </span>
                  )}
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
          {/* The stages, in order. Drag (or Alt+arrow) to reorder, click to edit. */}
          <div className="md:col-span-2">
            <p className={sectionTitle}>Stages · drag to reorder</p>
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
                      role="button"
                      tabIndex={0}
                      aria-pressed={on}
                      aria-label={`${r.name || 'Untitled'}, stage ${i + 1}. Alt and arrow keys move it.`}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragKey(r.key); }}
                      onDragEnd={() => { setDragKey(null); setDropAt(null); }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const box = e.currentTarget.getBoundingClientRect();
                        setDropAt(e.clientY > box.top + box.height / 2 ? i + 1 : i);
                      }}
                      onClick={() => pick(r.key)}
                      onKeyDown={(e) => {
                        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                          e.preventDefault();
                          shift(r.key, e.key === 'ArrowUp' ? -1 : 1);
                        } else if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          pick(r.key);
                        }
                      }}
                      className={cn(
                        'group flex cursor-pointer items-center gap-2 rounded-xl border px-2 py-2 outline-none transition-all focus-visible:shadow-[var(--ring-focus)]',
                        on
                          ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)] shadow-[var(--shadow-sm)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-default)]',
                        dragKey === r.key && 'opacity-40',
                      )}
                    >
                      <GripVertical aria-hidden="true" className="h-4 w-4 flex-shrink-0 cursor-grab text-[var(--text-tertiary)] opacity-60 group-hover:opacity-100" />
                      <span className={cn('h-2.5 w-2.5 flex-shrink-0 rounded-full', STAGE_TONE[colorOf(r, i)].dot)} />
                      <span className="min-w-0 flex-1 truncate text-body font-semibold text-[var(--text-primary)]">{r.name || 'Untitled'}</span>
                      {styled && r.checklist.length > 0 && (
                        <span className="inline-flex flex-shrink-0 items-center gap-0.5 text-micro tabular-nums text-[var(--text-tertiary)]" title="Checklist items">
                          <ListChecks className="h-3 w-3" />{r.checklist.length}
                        </span>
                      )}
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
                <span className={cn('flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-caption font-semibold tabular-nums', STAGE_TONE[colorOf(sel, selIndex)].solid)}>{selIndex + 1}</span>
                <input
                  aria-label="Stage name"
                  value={sel.name}
                  maxLength={60}
                  onChange={(e) => set(sel.key, { name: e.target.value })}
                  placeholder="Stage name"
                  className="min-w-0 flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2.5 py-1.5 text-strong font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--indigo)] focus-visible:shadow-[var(--ring-focus)]"
                />
                <span className="flex flex-shrink-0 items-center">
                  <button type="button" onClick={() => shift(sel.key, -1)} disabled={selIndex === 0} className="icon-btn h-8 w-7 text-[var(--text-tertiary)] disabled:opacity-30" aria-label="Move earlier" title="Move earlier"><ChevronUp className="h-4 w-4" /></button>
                  <button type="button" onClick={() => shift(sel.key, 1)} disabled={selIndex === rows.length - 1} className="icon-btn h-8 w-7 text-[var(--text-tertiary)] disabled:opacity-30" aria-label="Move later" title="Move later"><ChevronDown className="h-4 w-4" /></button>
                  <button type="button" onClick={() => duplicateStage(sel.key)} disabled={rows.length >= 20} className="icon-btn h-8 w-8 text-[var(--text-tertiary)] disabled:opacity-30" aria-label="Duplicate this stage" title="Duplicate this stage"><Copy className="h-3.5 w-3.5" /></button>
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
                </span>
              </div>

              {styled && (
                <div>
                  <p className={label}>Colour</p>
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Stage colour">
                    {STAGE_COLORS.map((c) => {
                      const on = colorOf(sel, selIndex) === c;
                      return (
                        <button
                          key={c}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          aria-label={STAGE_COLOR_LABEL[c]}
                          title={STAGE_COLOR_LABEL[c]}
                          onClick={() => set(sel.key, { color: c })}
                          className={cn(
                            'flex h-7 w-7 items-center justify-center rounded-full transition-transform hover:scale-110',
                            STAGE_TONE[c].solid,
                            on && 'ring-2 ring-[var(--text-primary)] ring-offset-2 ring-offset-[var(--bg-surface)]',
                          )}
                        >
                          {on && <Check className="h-3.5 w-3.5" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <p className={label}>How far along this counts</p>
                <div className="grid grid-cols-3 gap-1 rounded-xl bg-[var(--bg-muted)] p-1">
                  {PIPELINE_PHASES.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => set(sel.key, { phase: p })}
                      aria-pressed={sel.phase === p}
                      className={cn(
                        'rounded-lg py-1.5 text-body font-semibold transition-all',
                        sel.phase === p ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
                      )}
                    >
                      {PHASE_LABEL[p]}
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
                <p className={label}>Flag a deal as stalled after</p>
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

              {styled && (
                <>
                  <div>
                    <div className="mb-1.5 flex items-baseline justify-between">
                      <p className="text-body font-medium text-[var(--text-secondary)]">What it means to be here</p>
                      <span className="text-micro tabular-nums text-[var(--text-tertiary)]">{sel.description.length}/{STAGE_DESCRIPTION_MAX_LENGTH}</span>
                    </div>
                    <textarea
                      aria-label="What it means to be in this stage"
                      value={sel.description}
                      maxLength={STAGE_DESCRIPTION_MAX_LENGTH}
                      rows={2}
                      onChange={(e) => set(sel.key, { description: e.target.value })}
                      placeholder="e.g. They have seen pricing and a decision maker has said yes in principle."
                      className="w-full resize-none rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2.5 py-2 text-body text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--indigo)] focus-visible:shadow-[var(--ring-focus)]"
                    />
                    <p className="mt-1 text-caption text-[var(--text-tertiary)]">Shown on the board and on every deal in this stage, so the whole team moves deals on the same rules.</p>
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-baseline justify-between">
                      <p className="text-body font-medium text-[var(--text-secondary)]">Checklist before moving on</p>
                      <span className="text-micro tabular-nums text-[var(--text-tertiary)]">{sel.checklist.length}/{STAGE_CHECKLIST_MAX}</span>
                    </div>
                    {sel.checklist.length > 0 && (
                      <ul className="mb-2 space-y-1">
                        {sel.checklist.map((item, i) => (
                          <li key={item} className="group flex items-center gap-2 rounded-lg bg-[var(--bg-muted)]/60 px-2.5 py-1.5">
                            <span className="h-3.5 w-3.5 flex-shrink-0 rounded border border-[var(--border-default)]" aria-hidden="true" />
                            <span className="min-w-0 flex-1 truncate text-body text-[var(--text-primary)]">{item}</span>
                            <button type="button" onClick={() => set(sel.key, { checklist: sel.checklist.filter((_, j) => j !== i) })} className="icon-btn h-6 w-6 text-[var(--text-tertiary)] opacity-60 hover:text-rose-600 group-hover:opacity-100" aria-label={`Remove ${item}`}>
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {sel.checklist.length < STAGE_CHECKLIST_MAX && (
                      <div className="flex gap-2">
                        <input
                          aria-label="New checklist item"
                          value={newCheck}
                          maxLength={STAGE_CHECK_MAX_LENGTH}
                          onChange={(e) => setNewCheck(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCheck(); } }}
                          placeholder="e.g. Confirm the budget"
                          className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2.5 text-body text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--indigo)] focus-visible:shadow-[var(--ring-focus)]"
                        />
                        <Button variant="secondary" type="button" onClick={addCheck} disabled={!newCheck.trim()}>Add</Button>
                      </div>
                    )}
                    <p className="mt-1 text-caption text-[var(--text-tertiary)]">Every deal in this stage gets these to tick off, and cards show how far along they are.</p>
                  </div>
                </>
              )}

              {!styled && (
                <p className="rounded-lg bg-[var(--bg-muted)] px-3 py-2 text-caption text-[var(--text-tertiary)]">
                  Stage colours, notes and checklists switch on after the latest database update (migration 106).
                </p>
              )}
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

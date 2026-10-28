import { Fragment, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Ban, Check, Plus, X, type LucideIcon } from 'lucide-react';
import { foldText, prospectValueLabel } from '@lemlist/shared';
import type { ProspectSuggestion } from '@lemlist/shared';
import { prospectingApi } from '../../api/prospecting.api';
import { useDebounce } from '../../hooks/useDebounce';
import { TONE } from '../ui/tone';
import { cn } from '../../lib/utils';

/* One clock for every cycling placeholder on the page, paused for reduced motion. */
let tick = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
function subscribe(fn: () => void) {
  listeners.add(fn);
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!timer && !reduced) timer = setInterval(() => { tick++; listeners.forEach((l) => l()); }, 2800);
  return () => {
    listeners.delete(fn);
    if (!listeners.size && timer) { clearInterval(timer); timer = null; }
  };
}
/** Cycles through example values, so an empty box shows what it can take. */
export function useCyclingExample(examples: string[], offset = 0): string {
  const t = useSyncExternalStore(subscribe, () => tick, () => 0);
  return examples.length ? examples[(t + offset) % examples.length] : '';
}

/** Values pasted or typed as a list: commas, semicolons and new lines all split. */
const splitList = (s: string, commas = true) => s.split(commas ? /[,;\n\t]+/ : /[;\n\t]+/).map((v) => v.trim()).filter(Boolean);
const MAX_VALUES = 200;
/** Quick picks shown before "more", so a row stays short. */
const PICKS_SHOWN = 6;

/**
 * A filter box that takes as many values as the provider allows (200), with
 * a dropdown of real values as you type, and, where the field supports it,
 * values to leave out: switch to Exclude for the next value you add.
 * Clicking a tag does nothing but its cross removes it, so a stray click
 * can't quietly turn a filter inside out.
 */
export function TagFilter({
  label, icon: Icon, include, exclude, onChange, examples, prefix = 'Try', suggest, remote, listSeparator = true, offset = 0, preferPick = false,
  quickPicks, name,
}: {
  /** What the box is for, read out by screen readers when there is no visible label. */
  name?: string;
  /** Shown above the box; left out where the box sits under a row that already names it. */
  label?: string;
  icon?: LucideIcon;
  include: string[];
  /** Undefined when the field has no exclude list. */
  exclude?: string[];
  onChange: (include: string[], exclude: string[]) => void;
  /** Shown one at a time in the empty box. */
  examples: string[];
  prefix?: string;
  /** Local suggestions for what has been typed ("" = the whole list). */
  suggest?: (typed: string) => ProspectSuggestion[];
  /** Server-side suggestions instead. */
  remote?: 'locations';
  /** False where a value may itself hold commas ("Paris, France"): then only new lines and semicolons split. */
  listSeparator?: boolean;
  /** Staggers the cycling examples so neighbouring boxes don't change together. */
  offset?: number;
  /**
   * Enter takes the top suggestion rather than the text as typed. For fields
   * that only match known values (places, industries); a free-text field
   * like job title keeps exactly what was typed unless a row was arrowed to.
   */
  preferPick?: boolean;
  /** One-click bundles under the box, e.g. "Sales leaders" adds five titles. */
  quickPicks?: { label: string; values: string[] }[];
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [navigated, setNavigated] = useState(false);
  const [mode, setMode] = useState<'include' | 'exclude'>('include');
  const [allPicks, setAllPicks] = useState(false);
  const example = useCyclingExample(examples, offset);
  const excludes = exclude || [];
  const total = include.length + excludes.length;

  const typed = useDebounce(draft.trim(), 120);
  const { data: remoteHits = [], isFetching } = useQuery({
    queryKey: ['prospecting', 'suggest', remote, typed],
    queryFn: ({ signal }) => prospectingApi.suggestLocations(typed, signal),
    enabled: remote === 'locations' && open,
    staleTime: 10 * 60 * 1000,
    placeholderData: (prev) => prev,
    meta: { silentError: true },
  });

  const options = useMemo(() => {
    const taken = new Set([...include, ...excludes]);
    const hits = remote ? remoteHits : suggest ? suggest(draft.trim()) : [];
    return hits.filter((s) => !taken.has(s.value)).slice(0, 60);
  }, [remote, remoteHits, suggest, draft, include, excludes]);

  useEffect(() => { setActive(0); setNavigated(false); }, [draft, open]);
  // Remote rows are for what was typed a moment ago; Enter only trusts them once they catch up.
  const optionsCurrent = !remote || typed === draft.trim();

  const add = (values: string[]) => {
    if (!values.length) return;
    if (mode === 'exclude' && exclude) {
      onChange(include.filter((v) => !values.includes(v)), [...new Set([...excludes, ...values])].slice(0, MAX_VALUES));
    } else {
      onChange([...new Set([...include, ...values])].slice(0, MAX_VALUES), excludes.filter((v) => !values.includes(v)));
    }
    setDraft('');
    // Exclude is for one value at a time; staying in it would silently leave out everything typed next.
    setMode('include');
  };
  const commitDraft = () => add(listSeparator ? splitList(draft) : [draft.trim()].filter(Boolean));
  const pick = (s: ProspectSuggestion) => { add([s.value]); inputRef.current?.focus(); };
  const remove = (v: string) => onChange(include.filter((x) => x !== v), excludes.filter((x) => x !== v));
  // Leaving the box: free text keeps what was typed, but a known-value field only keeps a real match,
  // so "Lon" half-typed in Location never becomes a filter that finds nobody.
  const onLeave = () => {
    setOpen(false);
    if (!draft.trim()) return;
    if (!preferPick) { commitDraft(); return; }
    const exact = options.find((o) => foldText(o.label || o.value) === foldText(draft.trim()) || foldText(o.value) === foldText(draft.trim()));
    if (exact) add([exact.value]); else setDraft('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setNavigated(true); setActive((a) => Math.min(a + (navigated ? 1 : 0), Math.max(options.length - 1, 0))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setNavigated(true); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const row = open && optionsCurrent ? options[active] : undefined;
      const exact = row && (row.label || row.value).toLowerCase() === draft.trim().toLowerCase();
      if (row && (navigated || exact || preferPick || !draft.trim())) pick(row);
      else if (draft.trim()) commitDraft();
    } else if (e.key === ',' && listSeparator) { e.preventDefault(); commitDraft(); }
    else if (e.key === 'Escape') { setOpen(false); setDraft(''); }
    else if (e.key === 'Backspace' && !draft) {
      const last = excludes.length && mode === 'exclude' ? excludes[excludes.length - 1] : include[include.length - 1];
      if (last) remove(last);
    }
  };

  const excluding = mode === 'exclude' && !!exclude;
  const placeholder = excluding ? 'Leave out…' : total ? 'Add another…' : example ? `${prefix} ${example}` : '';
  const listId = `${id}-list`;
  const ariaLabel = name || 'Add values';

  return (
    <div>
      {label && (
        <label htmlFor={`${id}-in`} className="flex items-center gap-1.5 mb-1 text-caption font-medium text-[var(--text-secondary)]">
          {Icon && <Icon className="h-3 w-3 text-[var(--text-tertiary)]" />} {label}
        </label>
      )}

      <div className="relative">
        <div
          onClick={() => inputRef.current?.focus()}
          className={cn(
            'flex flex-wrap items-center gap-1 min-h-8 rounded-md border bg-[var(--bg-app)] px-1.5 py-1 cursor-text transition-[border-color,box-shadow]',
            'hover:border-[var(--border-strong)] focus-within:outline-none focus-within:shadow-[var(--ring-focus)]',
            excluding ? 'border-rose-500/40 focus-within:border-rose-500/60' : 'border-[var(--border-default)] focus-within:border-[var(--indigo)]',
          )}
        >
          {[...include.map((v) => [v, false] as const), ...excludes.map((v) => [v, true] as const)].map(([v, out]) => (
            <span key={`${out ? '-' : '+'}${v}`}
              className={cn('inline-flex items-center gap-0.5 max-w-full pl-1.5 pr-0.5 h-5 rounded text-caption font-medium',
                out ? cn(TONE.negative.bg, TONE.negative.text) : 'bg-[var(--indigo-subtle)] text-[var(--indigo-text)]')}>
              <span title={out ? 'Left out of the search' : undefined} className="inline-flex items-center gap-0.5 truncate">
                {out && <Ban className="h-2.5 w-2.5 flex-shrink-0" />}
                <span className="truncate">{out ? `Not ${prospectValueLabel(v)}` : prospectValueLabel(v)}</span>
              </span>
              <button type="button" aria-label={`Remove ${prospectValueLabel(v)}`} onClick={(e) => { e.stopPropagation(); remove(v); }}
                className="relative rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10 after:absolute after:-inset-1 after:content-['']">
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            id={`${id}-in`}
            role="combobox"
            aria-expanded={open && options.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={onLeave}
            onKeyDown={onKeyDown}
            onPaste={(e) => {
              const text = e.clipboardData.getData('text');
              // A pasted list becomes one tag per line; places keep their commas ("Austin, Texas").
              if ((listSeparator ? /[,;\n\t]/ : /[;\n\t]/).test(text)) { e.preventDefault(); add(splitList(text, listSeparator)); }
            }}
            placeholder={placeholder}
            aria-label={label ? undefined : ariaLabel}
            className="flex-1 min-w-20 h-6 bg-transparent px-1 text-body text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
          />
        </div>

        {open && (options.length > 0 || draft.trim()) && (
          <ul id={listId} role="listbox"
            className="absolute z-30 left-0 right-0 mt-1 max-h-72 overflow-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-1 shadow-lg"
            // Keep focus in the input so a click picks instead of blurring first.
            onMouseDown={(e) => e.preventDefault()}>
            {options.map((s, i) => (
              <Fragment key={s.value}>
              {s.group && s.group !== options[i - 1]?.group && (
                <li role="presentation" className="px-2.5 pt-2 pb-1 text-micro font-semibold text-[var(--text-tertiary)] first:pt-1">{s.group}</li>
              )}
              <li id={`${listId}-${i}`} role="option" aria-selected={i === active}
                onMouseEnter={() => { setActive(i); setNavigated(true); }} onClick={() => pick(s)}
 className={cn('flex items-center gap-2 px-2.5 py-1.5 cursor-pointer text-body',
                  i === active && (navigated || preferPick || !draft.trim()) ? 'bg-[var(--indigo-subtle)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]')}>
                <span className="flex-1 min-w-0 truncate">{s.label || prospectValueLabel(s.value)}</span>
                {s.hint && <span className="text-micro text-[var(--text-tertiary)] flex-shrink-0">{s.hint}</span>}
                {s.kind && <span className="text-micro font-medium text-[var(--text-tertiary)] flex-shrink-0">{s.kind}</span>}
              </li>
              </Fragment>
            ))}
            {draft.trim() && (
              <li role="option" aria-selected={false} onClick={commitDraft}
                className="px-2.5 py-1.5 cursor-pointer text-caption text-[var(--text-tertiary)] hover:text-[var(--text-primary)] border-t border-[var(--border-subtle)] mt-1">
                {excluding ? 'Leave out' : 'Add'} “{draft.trim()}” as typed <span className="text-micro">· Enter</span>
                {isFetching && remote ? <span className="ml-1 text-micro">· looking…</span> : null}
              </li>
            )}
          </ul>
        )}
      </div>

      {(exclude || total > 0) && (
        <div className="flex items-center gap-2 mt-1.5">
          {exclude && (
            <div role="group" aria-label="New values" className="inline-flex items-center rounded-md border border-[var(--border-subtle)] p-px">
              {(['include', 'exclude'] as const).map((m) => (
                <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
                  title={m === 'exclude' ? 'The next value you add is left out of the search' : 'What you add must match'}
                  className={cn('inline-flex items-center gap-1 h-5 px-1.5 rounded text-micro font-medium transition-colors',
                    mode === m
                      ? m === 'exclude' ? cn(TONE.negative.bg, TONE.negative.text) : 'bg-[var(--indigo-subtle)] text-[var(--indigo-text)]'
                      : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]')}>
                  {m === 'exclude' ? <><Ban className="h-2.5 w-2.5" /> Exclude</> : <><Check className="h-2.5 w-2.5" /> Include</>}
                </button>
              ))}
            </div>
          )}
          <span className="flex-1" />
          {total > 0 && (
            <button type="button" onClick={() => onChange([], [])}
              className="text-micro font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors">
              Clear {total}
            </button>
          )}
        </div>
      )}

      {quickPicks?.length ? (
        <div className="flex flex-wrap gap-1 mt-2">
          {(allPicks ? quickPicks : quickPicks.slice(0, PICKS_SHOWN)).map((p) => {
            const on = p.values.every((v) => include.includes(v));
            return (
              <button key={p.label} type="button" aria-pressed={on}
                onClick={() => on ? onChange(include.filter((v) => !p.values.includes(v)), excludes) : add(p.values)}
                title={p.values.join(', ')}
                className={cn('inline-flex items-center gap-1 h-6 px-2 rounded-full border text-caption font-medium transition-colors',
                  on ? 'border-[var(--indigo)]/30 bg-[var(--indigo-subtle)] text-[var(--indigo-text)]'
                    : 'border-dashed border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--indigo)]/40 hover:text-[var(--indigo-text)]')}>
                {on ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />} {p.label}
              </button>
            );
          })}
          {quickPicks.length > PICKS_SHOWN && (
            <button type="button" onClick={() => setAllPicks(!allPicks)}
              className="h-6 px-1.5 text-caption font-medium text-[var(--text-tertiary)] hover:text-[var(--indigo-text)] transition-colors">
              {allPicks ? 'Fewer' : `${quickPicks.length - PICKS_SHOWN} more`}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

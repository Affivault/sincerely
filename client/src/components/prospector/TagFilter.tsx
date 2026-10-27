import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Ban, X, type LucideIcon } from 'lucide-react';
import { prospectValueLabel } from '@lemlist/shared';
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

/**
 * A filter box that takes as many values as the provider allows (200), with
 * a dropdown of real values as you type, and, where the field supports it,
 * values to leave out: switch to Exclude, or click a tag to flip it.
 */
export function TagFilter({
  label, icon: Icon, include, exclude, onChange, examples, prefix = 'Try', suggest, remote, listSeparator = true, offset = 0, preferPick = false,
}: {
  label: string;
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
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [navigated, setNavigated] = useState(false);
  const [mode, setMode] = useState<'include' | 'exclude'>('include');
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
  };
  const commitDraft = () => add(listSeparator ? splitList(draft) : [draft.trim()].filter(Boolean));
  const pick = (s: ProspectSuggestion) => { add([s.value]); inputRef.current?.focus(); };
  const remove = (v: string) => onChange(include.filter((x) => x !== v), excludes.filter((x) => x !== v));
  const flip = (v: string) => {
    if (!exclude) return;
    if (include.includes(v)) onChange(include.filter((x) => x !== v), [...excludes, v]);
    else onChange([...include, v], excludes.filter((x) => x !== v));
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
    else if (e.key === 'Escape') { setOpen(false); }
    else if (e.key === 'Backspace' && !draft) {
      const last = excludes.length && mode === 'exclude' ? excludes[excludes.length - 1] : include[include.length - 1];
      if (last) remove(last);
    }
  };

  const excluding = mode === 'exclude' && !!exclude;
  const placeholder = excluding ? 'Leave out…' : total ? 'Add another…' : example ? `${prefix} ${example}` : '';
  const listId = `${id}-list`;

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <label htmlFor={`${id}-in`} className="flex items-center gap-1.5 text-caption font-medium text-[var(--text-secondary)]">
          {Icon && <Icon className="h-3 w-3 text-[var(--text-tertiary)]" />} {label}
        </label>
        {total > 0 && <span className="text-micro font-medium text-[var(--indigo-text)] tabular">{total}</span>}
        <span className="flex-1" />
        {total > 0 && (
          <button type="button" onClick={() => onChange([], [])}
            className="text-micro font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors">
            Clear
          </button>
        )}
        {exclude && (
          <button type="button" onClick={() => setMode(excluding ? 'include' : 'exclude')} aria-pressed={excluding}
            title="Values typed while this is on are left out of the search"
            className={cn('inline-flex items-center gap-0.5 h-4 px-1 rounded text-micro font-medium transition-colors',
              excluding ? cn(TONE.negative.bg, TONE.negative.text) : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]')}>
            <Ban className="h-2.5 w-2.5" /> Exclude
          </button>
        )}
      </div>

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
              <button type="button" onClick={(e) => { e.stopPropagation(); flip(v); }} disabled={!exclude}
                title={exclude ? (out ? 'Excluded: click to include instead' : 'Click to exclude instead') : undefined}
                className="inline-flex items-center gap-0.5 truncate disabled:cursor-default">
                {out && <Ban className="h-2.5 w-2.5 flex-shrink-0" />}
                <span className="truncate">{prospectValueLabel(v)}</span>
              </button>
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
            onBlur={() => { setOpen(false); if (draft.trim()) commitDraft(); }}
            onKeyDown={onKeyDown}
            onPaste={(e) => {
              const text = e.clipboardData.getData('text');
              // A pasted list becomes one tag per line; places keep their commas ("Austin, Texas").
              if ((listSeparator ? /[,;\n\t]/ : /[;\n\t]/).test(text)) { e.preventDefault(); add(splitList(text, listSeparator)); }
            }}
            placeholder={placeholder}
            className="flex-1 min-w-20 h-6 bg-transparent px-1 text-body text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
          />
        </div>

        {open && (options.length > 0 || draft.trim()) && (
          <ul id={listId} role="listbox"
            className="absolute z-30 left-0 right-0 mt-1 max-h-64 overflow-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-1 shadow-lg"
            // Keep focus in the input so a click picks instead of blurring first.
            onMouseDown={(e) => e.preventDefault()}>
            {options.map((s, i) => (
              <li key={s.value} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                onMouseEnter={() => { setActive(i); setNavigated(true); }} onClick={() => pick(s)}
 className={cn('flex items-center gap-2 px-2.5 py-1.5 cursor-pointer text-body',
                  i === active && (navigated || preferPick || !draft.trim()) ? 'bg-[var(--indigo-subtle)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]')}>
                <span className="flex-1 min-w-0 truncate">{s.label || prospectValueLabel(s.value)}</span>
                {s.hint && <span className="text-micro text-[var(--text-tertiary)] flex-shrink-0">{s.hint}</span>}
                {s.kind && <span className="text-micro font-medium text-[var(--text-tertiary)] flex-shrink-0">{s.kind}</span>}
              </li>
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
    </div>
  );
}

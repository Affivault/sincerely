import { useId, useState } from 'react';
import { ChevronDown, SlidersHorizontal, Ban, Plus } from 'lucide-react';
import { PROSPECT_FILTER_FIELDS, countAdvancedFilters } from '@lemlist/shared';
import type { ProspectAdvancedValue, ProspectFilterField, ProspectGrowthFilter, ProspectRangeFilter, ProspectTextFilter } from '@lemlist/shared';
import { cn } from '../../lib/utils';
import { ChipInput } from './ChipInput';

type Advanced = Record<string, ProspectAdvancedValue>;

const GROUPS: ProspectFilterField['group'][] = ['Person', 'Current role', 'Current company', 'Past roles'];
const SPANS: { value: ProspectGrowthFilter['timespan']; label: string }[] = [
  { value: '6months', label: '6 months' },
  { value: '12months', label: '12 months' },
  { value: '24months', label: '24 months' },
];

const inputClass = 'block w-full h-8 rounded-md border border-[var(--border-default)] bg-[var(--bg-app)] px-2 text-body text-[var(--text-primary)] tabular placeholder:text-[var(--text-tertiary)] hover:border-[var(--border-strong)] focus:border-[var(--indigo)] focus:outline-none focus:shadow-[var(--ring-focus)] transition-[border-color,box-shadow]';

function hasValue(v: ProspectAdvancedValue | undefined): boolean {
  return countAdvancedFilters(v ? { x: v } : undefined) > 0;
}

function RangeInputs({ field, value, onChange }: {
  field: ProspectFilterField;
  value: ProspectRangeFilter | undefined;
  onChange: (v: ProspectRangeFilter) => void;
}) {
  const id = useId();
  const read = (s: string) => (s.trim() === '' ? null : Number(s));
  return (
    <div>
      <label htmlFor={`${id}-min`} className="text-caption font-medium text-[var(--text-secondary)] mb-1 block">
        {field.label}{field.unit ? <span className="text-[var(--text-tertiary)]"> ({field.unit})</span> : null}
      </label>
      <div className="flex items-center gap-1.5">
        <input id={`${id}-min`} type="number" inputMode="numeric" placeholder="Min" aria-label={`${field.label} minimum`}
          value={value?.min ?? ''} onChange={(e) => onChange({ ...value, min: read(e.target.value) })} className={inputClass} />
        <span className="text-caption text-[var(--text-tertiary)]">to</span>
        <input type="number" inputMode="numeric" placeholder="Max" aria-label={`${field.label} maximum`}
          value={value?.max ?? ''} onChange={(e) => onChange({ ...value, max: read(e.target.value) })} className={inputClass} />
      </div>
    </div>
  );
}

function GrowthInputs({ field, value, onChange }: {
  field: ProspectFilterField;
  value: ProspectGrowthFilter | undefined;
  onChange: (v: ProspectGrowthFilter) => void;
}) {
  const id = useId();
  const current: ProspectGrowthFilter = value || { timespan: '12months' };
  const read = (s: string) => (s.trim() === '' ? null : Number(s));
  return (
    <div>
      <label htmlFor={`${id}-span`} className="text-caption font-medium text-[var(--text-secondary)] mb-1 block">
        {field.label} <span className="text-[var(--text-tertiary)]">(%)</span>
      </label>
      <div className="flex items-center gap-1.5">
        <select id={`${id}-span`} value={current.timespan} aria-label={`${field.label} period`}
          onChange={(e) => onChange({ ...current, timespan: e.target.value as ProspectGrowthFilter['timespan'] })}
          className={cn(inputClass, 'w-auto flex-shrink-0 pr-1')}>
          {SPANS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <input type="number" placeholder="Min" aria-label={`${field.label} minimum %`}
          value={current.min ?? ''} onChange={(e) => onChange({ ...current, min: read(e.target.value) })} className={inputClass} />
        <input type="number" placeholder="Max" aria-label={`${field.label} maximum %`}
          value={current.max ?? ''} onChange={(e) => onChange({ ...current, max: read(e.target.value) })} className={inputClass} />
      </div>
    </div>
  );
}

function TextField({ field, value, onChange }: {
  field: ProspectFilterField;
  value: ProspectTextFilter | undefined;
  onChange: (v: ProspectTextFilter) => void;
}) {
  // Excludes stay tucked away until asked for, or until one is set.
  const [showExclude, setShowExclude] = useState(!!value?.exclude?.length || !!field.basic);
  return (
    <div className="space-y-1.5">
      {!field.basic && (
        <ChipInput label={field.label} icon={Plus} values={value?.include || []}
          onChange={(include) => onChange({ ...value, include })} placeholder={field.placeholder || 'Type and press Enter…'} />
      )}
      {showExclude ? (
        <ChipInput label={field.basic ? `Exclude ${field.label.toLowerCase()}` : 'Exclude'} icon={Ban} values={value?.exclude || []}
          onChange={(exclude) => onChange({ ...value, exclude })} placeholder="Leave out…" />
      ) : (
        <button type="button" onClick={() => setShowExclude(true)}
          className="text-caption font-medium text-[var(--text-tertiary)] hover:text-[var(--indigo-text)] transition-colors">
          + Exclude some
        </button>
      )}
    </div>
  );
}

/**
 * Every people-search filter the data provider supports beyond the main
 * panel: past roles, skills, schools, languages, company type, revenue,
 * growth, tenure, and an exclude list for each text filter.
 */
export function AdvancedFilters({ value, onChange }: { value: Advanced; onChange: (v: Advanced) => void }) {
  const [open, setOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(['Person']));
  const active = countAdvancedFilters(value);
  const set = (key: string, v: ProspectAdvancedValue) => onChange({ ...value, [key]: v });

  return (
    <div className="rounded-lg border border-[var(--border-subtle)]">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="w-full flex items-center gap-1.5 h-8 px-2.5 text-caption font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
        <SlidersHorizontal className="h-3 w-3 text-[var(--text-tertiary)]" />
        More filters
        {active > 0 && <span className="inline-flex items-center px-1.5 h-[17px] rounded bg-[var(--indigo-subtle)] text-micro font-medium text-[var(--indigo-text)] tabular">{active}</span>}
        <span className="flex-1" />
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
          {GROUPS.map((group) => {
            const fields = PROSPECT_FILTER_FIELDS.filter((f) => f.group === group);
            const groupActive = fields.filter((f) => hasValue(value[f.key])).length;
            const expanded = openGroups.has(group);
            return (
              <div key={group}>
                <button type="button" aria-expanded={expanded}
                  onClick={() => setOpenGroups((prev) => { const next = new Set(prev); if (next.has(group)) next.delete(group); else next.add(group); return next; })}
                  className="w-full flex items-center gap-1.5 h-8 px-2.5 text-caption font-semibold text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
                  {group}
                  {groupActive > 0 && <span className="text-[var(--indigo-text)] tabular">· {groupActive}</span>}
                  <span className="flex-1" />
                  <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
                </button>
                {expanded && (
                  <div className="px-2.5 pb-3 space-y-3">
                    {fields.map((field) => field.kind === 'text' ? (
                      <TextField key={field.key} field={field} value={value[field.key] as ProspectTextFilter | undefined} onChange={(v) => set(field.key, v)} />
                    ) : field.kind === 'range' ? (
                      <RangeInputs key={field.key} field={field} value={value[field.key] as ProspectRangeFilter | undefined} onChange={(v) => set(field.key, v)} />
                    ) : (
                      <GrowthInputs key={field.key} field={field} value={value[field.key] as ProspectGrowthFilter | undefined} onChange={(v) => set(field.key, v)} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

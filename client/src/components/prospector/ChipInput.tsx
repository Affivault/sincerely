import { useId, useState } from 'react';
import { X, type LucideIcon } from 'lucide-react';

/** Comma/enter separated chip input for multi-value filters. */
export function ChipInput({
  label, icon: Icon, values, onChange, placeholder, suggestions,
}: {
  label: string;
  icon: LucideIcon;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  /** Offered as the user types, for fields that only match exact values. */
  suggestions?: string[];
}) {
  const a11yId = useId();
  const [draft, setDraft] = useState('');
  const commit = () => {
    const parts = draft.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...new Set([...values, ...parts])]);
    setDraft('');
  };
  return (
    <div>
      <label htmlFor={`${a11yId}-f1`} className="flex items-center gap-1.5 text-caption font-medium text-[var(--text-secondary)] mb-1">
        <Icon className="h-3 w-3 text-[var(--text-tertiary)]" /> {label}
      </label>
      <input id={`${a11yId}-f1`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); } }}
        onBlur={commit}
        placeholder={placeholder}
        list={suggestions?.length ? `${a11yId}-list` : undefined}
        className="block w-full h-8 rounded-md border border-[var(--border-default)] bg-[var(--bg-app)] px-2.5 text-body text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] hover:border-[var(--border-strong)] focus:border-[var(--indigo)] focus:outline-none focus:shadow-[var(--ring-focus)] transition-[border-color,box-shadow]"
      />
      {suggestions?.length ? (
        <datalist id={`${a11yId}-list`}>
          {suggestions.map((s) => <option key={s} value={s} />)}
        </datalist>
      ) : null}
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {values.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 pl-2 pr-1 h-[20px] rounded-md bg-[var(--indigo-subtle)] text-caption font-medium text-[var(--indigo-text)]">
              {v}
              <button aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="relative rounded hover:bg-[var(--indigo)]/15 p-0.5 after:absolute after:-inset-1.5 after:content-['']">
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import {
  BLACKOUT_PRESETS, MAX_BLACKOUT_DATES, describeBlackoutDate, normalizeBlackoutDate, normalizeBlackoutDates,
} from '@lemlist/shared';
import { Chip } from '../ui/Chip';

/**
 * Days nothing goes out - the account's list in Settings, and a campaign's
 * own extra days in the builder. One editor for both, so a date means the
 * same thing wherever it is typed (shared/blackout).
 *
 * Presets are annual: Christmas is the 25th every year, and a list that has
 * to be re-entered each December is a list that is wrong the first December
 * somebody forgets. A picked date can be made annual too.
 */
export function BlackoutDatesEditor({
  value,
  onChange,
  idPrefix,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  /** Keeps label ids unique when two editors share a page. */
  idPrefix: string;
}) {
  const [picked, setPicked] = useState('');
  const [everyYear, setEveryYear] = useState(false);
  const full = value.length >= MAX_BLACKOUT_DATES;

  const set = (next: string[]) => onChange(normalizeBlackoutDates(next));
  const toggle = (date: string) => set(value.includes(date) ? value.filter((d) => d !== date) : [...value, date]);
  const add = () => {
    const entry = normalizeBlackoutDate(everyYear ? picked.slice(5) : picked);
    if (!entry) return;
    set([...value, entry]);
    setPicked('');
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Common holidays">
        {BLACKOUT_PRESETS.map((p) => (
          <Chip key={p.date} active={value.includes(p.date)} onClick={() => toggle(p.date)} title={describeBlackoutDate(p.date)}>
            {p.label}
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${idPrefix}-blackout-date`} className="sr-only">Add a date</label>
        <input
          id={`${idPrefix}-blackout-date`}
          type="date"
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          className="h-8 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-body text-[var(--text-primary)] focus:border-[var(--indigo)] focus:outline-none"
        />
        <label className="inline-flex items-center gap-1.5 text-body text-[var(--text-secondary)]">
          <input type="checkbox" checked={everyYear} onChange={(e) => setEveryYear(e.target.checked)} />
          Every year
        </label>
        <button
          type="button"
          onClick={add}
          disabled={!picked || full}
          className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-[var(--border-subtle)] text-body font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>

      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Closed days">
          {value.map((d) => (
            <li
              key={d}
              className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-caption text-[var(--text-secondary)]"
            >
              {describeBlackoutDate(d)}
              <button
                type="button"
                onClick={() => toggle(d)}
                className="icon-btn h-5 w-5"
                aria-label={`Remove ${describeBlackoutDate(d)}`}
                title="Remove"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-caption text-[var(--text-tertiary)]">No closed days yet.</p>
      )}
    </div>
  );
}

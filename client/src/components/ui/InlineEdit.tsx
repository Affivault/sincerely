import { useState, useRef, useEffect } from 'react';
import { cn } from '../../lib/utils';
import { Check, X, Loader2, Pencil } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════════
   Edit in place.

   Changing a job title used to mean: open a modal, find the field, type,
   save, close. Five actions to alter one string. Here the value IS the
   input — click it, type, press Enter. Escape reverts, blur saves, and a
   failed save puts the old value back rather than leaving a lie on screen.
   ═══════════════════════════════════════════════════════════════════════ */

export function InlineEdit({
  value, onSave, placeholder = 'Empty', type = 'text', multiline = false,
  className, inputClassName, textClassName, disabled, format, ariaLabel,
}: {
  value: string | number | null | undefined;
  /** Resolve to commit, reject to roll back. */
  onSave: (next: string) => Promise<unknown>;
  placeholder?: string;
  type?: 'text' | 'number' | 'email' | 'url' | 'tel';
  multiline?: boolean;
  className?: string;
  /** Replaces the input's default type styling (not merged onto it). */
  inputClassName?: string;
  /** Type styling for the resting value — headings need more than 12.5px. */
  textClassName?: string;
  disabled?: boolean;
  /** How the committed value reads when not editing (currency, dates…). */
  format?: (v: string) => string;
  ariaLabel?: string;
}) {
  const initial = value == null ? '' : String(value);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  // A save in flight must not be clobbered by the blur it triggers.
  const committing = useRef(false);

  // Adopt external changes (another surface edited the same record) — but
  // never while the user is mid-edit, or their typing would vanish.
  useEffect(() => {
    if (!editing) setDraft(initial);
  }, [initial, editing]);

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    el?.focus();
    if (el && 'select' in el) el.select();
  }, [editing]);

  const commit = async () => {
    if (committing.current) return;
    const next = draft.trim();
    if (next === initial.trim()) { setEditing(false); return; }
    committing.current = true;
    setSaving(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch {
      // Put the old value back: a field showing something that didn't save
      // is worse than one that never changed.
      setDraft(initial);
      setEditing(false);
    } finally {
      setSaving(false);
      committing.current = false;
    }
  };

  const cancel = () => { setDraft(initial); setEditing(false); };

  if (disabled) {
    return <span className={cn('text-body text-[var(--text-secondary)]', className)}>{initial || placeholder}</span>;
  }

  if (!editing) {
    const shown = initial ? (format ? format(initial) : initial) : '';
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={ariaLabel ? `Edit ${ariaLabel}` : 'Edit'}
        className={cn(
          'group/ie relative text-left rounded-md px-1.5 py-0.5 -mx-1.5 transition-colors',
          // One line, text then pencil, as wide as the text. As inline flow at
          // full width, a value filling the row pushed the (invisible) pencil
          // onto a second line, so every field was a line taller than its
          // text - most visibly the gap under a contact's name on their page.
          multiline ? 'block w-full' : 'inline-flex max-w-full items-center',
          'hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)] focus:outline-none',
          className,
        )}
      >
        {/* cn is plain clsx, so a caller's size class would merely collide with
            the default rather than beat it — drop the default when one is given. */}
        <span className={cn(
          !textClassName && 'text-body',
          shown ? textClassName || 'text-[var(--text-secondary)]' : 'text-[var(--text-tertiary)] italic',
          multiline ? 'whitespace-pre-wrap' : 'min-w-0 truncate',
          textClassName,
        )}>
          {shown || placeholder}
        </span>
        <Pencil aria-hidden className="inline-block flex-shrink-0 ml-1.5 h-2.5 w-2.5 align-middle text-[var(--text-tertiary)] opacity-0 group-hover/ie:opacity-100 group-focus-visible/ie:opacity-100 transition-opacity" />
      </button>
    );
  }

  const shared = {
    ref: inputRef as any,
    // The resting button is named "Edit <label>"; the field it turns into
    // must carry the name too, or it is an unlabelled textbox.
    'aria-label': ariaLabel ?? 'Edit value',
    value: draft,
    disabled: saving,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      // Enter commits on a single line; multiline needs ⌘↵ so newlines work.
      else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
    },
    className: cn(
      'w-full rounded-md border border-[var(--indigo)] bg-[var(--bg-app)] px-1.5 py-0.5 -mx-1.5',
      !inputClassName && 'text-body',
      'text-[var(--text-primary)] outline-none',
      'focus:shadow-[var(--ring-focus)] disabled:opacity-60',
      inputClassName,
    ),
  };

  return (
    <span className="relative block">
      {multiline
        ? <textarea {...shared} rows={3} />
        : <input {...shared} type={type} inputMode={type === 'number' ? 'decimal' : undefined} />}
      <span aria-hidden className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 pointer-events-none">
        {saving
          ? <Loader2 className="h-3 w-3 animate-spin text-[var(--indigo-text)]" />
          : (
            <>
              <Check className="h-3 w-3 text-[var(--text-tertiary)]" />
              <X className="h-3 w-3 text-[var(--text-tertiary)]" />
            </>
          )}
      </span>
    </span>
  );
}

/** Same idea for a fixed set of options — click, pick, done. */
export function InlineSelect<T extends string>({
  value, options, onSave, className, disabled, renderValue, ariaLabel,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onSave: (next: T) => Promise<unknown>;
  className?: string;
  disabled?: boolean;
  renderValue?: (v: T) => React.ReactNode;
  /** Names the control for assistive tech ("Headcount"); the value is announced after it. */
  ariaLabel?: string;
}) {
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  const pick = async (next: T) => {
    setOpen(false);
    if (next === value) return;
    setSaving(true);
    try { await onSave(next); } catch { /* caller surfaces the failure */ }
    finally { setSaving(false); }
  };

  const current = options.find((o) => o.value === value);

  if (disabled) return <span className={className}>{renderValue ? renderValue(value) : current?.label}</span>;

  return (
    <span
      className="relative inline-block"
      // Close when focus leaves the whole control, not when it moves from the
      // trigger onto an option (a timer here closed the list before a keyboard
      // user's Tab could reach it).
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); } }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={ariaLabel ? `${ariaLabel}: ${current?.label || value || 'none'}` : undefined}
        className={cn(
          'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 -mx-1.5 transition-colors',
          'hover:bg-[var(--bg-hover)] focus:outline-none focus-visible:bg-[var(--bg-hover)]',
          className,
        )}
      >
        {saving ? <Loader2 className="h-3 w-3 animate-spin text-[var(--indigo-text)]" /> : null}
        {renderValue ? renderValue(value) : <span className="text-body text-[var(--text-secondary)]">{current?.label || value}</span>}
      </button>
      {open && (
        <span className="absolute left-0 top-full mt-1 z-50 min-w-[140px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-lg)] overflow-hidden block">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); pick(o.value); }}
              // Enter/Space on a focused option is a click with no pointer (detail 0);
              // a mouse click already picked on mousedown.
              onClick={(e) => { if (e.detail === 0) pick(o.value); }}
              className={cn(
                'w-full text-left px-2.5 py-1.5 text-body transition-colors',
                o.value === value
                  ? 'bg-[var(--indigo-subtle)] text-[var(--indigo-text)] font-medium'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
              )}
            >
              {o.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

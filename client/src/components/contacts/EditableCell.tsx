import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Pencil } from 'lucide-react';
import { contactsApi } from '../../api/contacts.api';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   Fix a value where you see it.

   A wrong job title used to mean: open the person, find the field, edit,
   save, close, find your place again. Now: double-click the cell, type,
   Enter. Single click still opens the person (the row's job), so editing
   never gets in the way of reading.

   The table updates at once and the change is saved behind it; if the
   save is refused the old value comes back and says why. Tab saves and
   moves to the next editable cell on the row, as in a spreadsheet.
   ═══════════════════════════════════════════════════════════════════════ */

type Field = 'job_title' | 'phone' | 'location' | 'country' | 'city' | 'state' | 'industry' | 'company' | 'website' | 'linkedin_url' | 'name';

/** Patch every cached page of contacts that holds this person. */
function patchCache(qc: ReturnType<typeof useQueryClient>, id: string, patch: Record<string, unknown>) {
  qc.setQueriesData({ queryKey: ['contacts'] }, (old: any) => {
    if (!old || !Array.isArray(old.data)) return old;
    let hit = false;
    const data = old.data.map((c: any) => (c.id === id ? ((hit = true), { ...c, ...patch }) : c));
    return hit ? { ...old, data } : old;
  });
}

function toPatch(field: Field, value: string): Record<string, string | null> {
  const v = value.trim();
  if (field !== 'name') return { [field]: v || null };
  const cut = v.indexOf(' ');
  return cut === -1 ? { first_name: v || null, last_name: null } : { first_name: v.slice(0, cut), last_name: v.slice(cut + 1).trim() || null };
}

export function EditableCell({ contact, field, value, children, type = 'text', placeholder }: {
  contact: { id: string; [k: string]: any };
  field: Field;
  /** The editable text (for name: "First Last"). */
  value: string | null | undefined;
  /** How it reads when not editing. */
  children: ReactNode;
  type?: 'text' | 'tel' | 'url';
  placeholder?: string;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const input = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  /* A single click still opens the person, but waits a beat: the first
     click of a double-click must not open the side panel first. */
  const clickTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(clickTimer.current), []);

  useEffect(() => {
    if (editing) {
      done.current = false;
      setDraft(value ?? '');
      requestAnimationFrame(() => { input.current?.focus(); input.current?.select(); });
    }
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = async (moveNext?: boolean) => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    const before = value ?? '';
    if (draft.trim() === before.trim()) {
      if (moveNext) focusNext();
      return;
    }
    const patch = toPatch(field, draft);
    const previous: Record<string, unknown> = {};
    for (const k of Object.keys(patch)) previous[k] = contact[k] ?? null;
    patchCache(qc, contact.id, patch);
    if (moveNext) focusNext();
    try {
      await contactsApi.update(contact.id, patch as any);
      qc.invalidateQueries({ queryKey: ['contacts', contact.id] });
    } catch (e: any) {
      patchCache(qc, contact.id, previous);
      toast.error(e?.response?.data?.error || 'Could not save that change');
    }
  };

  // Tab: the next editable cell on the same row.
  const focusNext = () => {
    const row = wrap.current?.closest('tr');
    if (!row) return;
    const cells = Array.from(row.querySelectorAll<HTMLElement>('[data-editable-cell]'));
    const at = cells.findIndex((el) => el === wrap.current);
    const next = cells[at + 1];
    if (next) next.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  };

  if (editing) {
    return (
      <div ref={wrap} data-editable-cell className="-my-1 -mx-1.5" onClick={(e) => e.stopPropagation()}>
        <input
          ref={input}
          type={type}
          value={draft}
          placeholder={placeholder}
          aria-label={`Edit ${field.replace('_', ' ')}`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); done.current = true; setEditing(false); }
            else if (e.key === 'Tab') { e.preventDefault(); commit(true); }
          }}
          className="w-full h-7 px-1.5 rounded-md border border-[var(--indigo)] bg-[var(--bg-surface)] text-body text-[var(--text-primary)] outline-none ring-2 ring-[var(--indigo)]/15"
        />
      </div>
    );
  }

  return (
    <div
      ref={wrap}
      data-editable-cell
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return; // the row's own modifiers
        e.stopPropagation();
        clearTimeout(clickTimer.current);
        const row = wrap.current?.closest('tr');
        clickTimer.current = setTimeout(() => row?.dispatchEvent(new MouseEvent('click', { bubbles: true })), 220);
      }}
      onDoubleClick={(e) => { e.stopPropagation(); clearTimeout(clickTimer.current); setEditing(true); }}
      title="Double-click to edit"
      className="group/edit flex items-center gap-1 min-w-0"
    >
      <span className="min-w-0 truncate">{children}</span>
      <button
        type="button"
        tabIndex={-1}
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        aria-label={`Edit ${field.replace('_', ' ')}`}
        className="flex-shrink-0 opacity-0 group-hover/edit:opacity-100 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-opacity"
      >
        <Pencil className="h-3 w-3" />
      </button>
    </div>
  );
}

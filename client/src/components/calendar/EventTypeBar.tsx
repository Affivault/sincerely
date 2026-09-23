import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Check, Trash2, Loader2 } from 'lucide-react';
import {
  EVENT_COLOURS, EVENT_LOCATION_KINDS, DEFAULT_EVENT_COLOUR,
  durationLabel, type CalendarEventType,
} from '@lemlist/shared';
import { calendarApi } from '../../api/calendar.api';
import { Modal } from '../ui/Modal';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

/* ═══════════════════════════════════════════════════════════════════════
   The calendar's legend, and the place its colours are decided.

   Doubles as a filter, because the two questions are the same one asked in
   opposite directions: "what does orange mean?" and "show me only the
   orange ones." Keeping them in one strip means the colour key is never a
   thing you have to go and find in settings.
   ═══════════════════════════════════════════════════════════════════════ */

export function EventTypeBar({ types, hidden, onToggle, showUnsorted }: {
  types: CalendarEventType[];
  hidden: Set<string>;
  onToggle: (id: string) => void;
  /**
   * Whether anything on screen has no kind at all.
   *
   * Without a chip for it, turning every kind off left a handful of grey
   * blocks on the grid with nothing switched on to explain them - which
   * reads as the filter being broken rather than as those meetings simply
   * not having a kind.
   */
  showUnsorted?: boolean;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<CalendarEventType | null>(null);
  const [adding, setAdding] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['calendar', 'types'] });
    // The grid colours events from these, so it has to redraw too.
    qc.invalidateQueries({ queryKey: ['crm', 'events'] });
  };

  const save = useMutation({
    mutationFn: ({ id, patch }: { id: string | null; patch: any }) =>
      id ? calendarApi.updateType(id, patch) : calendarApi.createType(patch),
    onSuccess: () => { invalidate(); setEditing(null); setAdding(false); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save that'),
  });

  const archive = useMutation({
    mutationFn: (id: string) => calendarApi.archiveType(id),
    onSuccess: (r) => {
      invalidate();
      setEditing(null);
      toast.success(r.events > 0
        // Says what happened to the meetings, because "deleted" would be a
        // lie and people reasonably fear losing history.
        ? `Retired. The ${r.events} meeting${r.events === 1 ? '' : 's'} already booked keep it.`
        : 'Retired.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not retire that'),
  });

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {types.map((t) => {
        const off = hidden.has(t.id);
        return (
          <button
            key={t.id}
            onClick={() => onToggle(t.id)}
            onDoubleClick={() => setEditing(t)}
            title={`${t.name} · ${durationLabel(t.duration_minutes)} · double-click to edit`}
            className={cn(
              'inline-flex items-center gap-1.5 h-7 rounded-full border px-2.5 text-caption font-medium transition-colors',
              off
                ? 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-tertiary)]'
                : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)]',
            )}
          >
            <span
              className="h-2 w-2 flex-shrink-0 rounded-full"
              style={{ background: off ? 'transparent' : t.colour, boxShadow: off ? `inset 0 0 0 1.5px ${t.colour}` : undefined }}
            />
            {t.name}
            <span className="tabular text-micro text-[var(--text-tertiary)]">{durationLabel(t.duration_minutes)}</span>
          </button>
        );
      })}

      {showUnsorted && (() => {
        const off = hidden.has('none');
        return (
          <button
            onClick={() => onToggle('none')}
            title="Meetings with no kind - anything booked before you had any, or filed under none"
            className={cn(
              'inline-flex items-center gap-1.5 h-7 rounded-full border border-dashed px-2.5 text-caption font-medium transition-colors',
              off
                ? 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-tertiary)]'
                : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)]',
            )}
          >
            <span className={cn(
              'h-2 w-2 flex-shrink-0 rounded-full',
              off ? 'ring-1 ring-inset ring-[var(--text-tertiary)]' : 'bg-[var(--text-tertiary)]',
            )} />
            No kind
          </button>
        );
      })()}

      <button
        onClick={() => setAdding(true)}
        className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-[var(--border-default)] px-2.5 text-caption font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--indigo)] transition-colors"
      >
        <Plus className="h-3 w-3" /> Kind of meeting
      </button>

      {(editing || adding) && (
        <TypeEditor
          type={editing}
          busy={save.isPending || archive.isPending}
          onCancel={() => { setEditing(null); setAdding(false); }}
          onSave={(patch) => save.mutate({ id: editing?.id ?? null, patch })}
          onArchive={editing ? () => archive.mutate(editing.id) : undefined}
        />
      )}
    </div>
  );
}

function TypeEditor({ type, busy, onSave, onCancel, onArchive }: {
  type: CalendarEventType | null;
  busy: boolean;
  onSave: (patch: any) => void;
  onCancel: () => void;
  onArchive?: () => void;
}) {
  const [name, setName] = useState(type?.name ?? '');
  const [colour, setColour] = useState(type?.colour ?? DEFAULT_EVENT_COLOUR);
  const [minutes, setMinutes] = useState(type?.duration_minutes ?? 30);
  const [location, setLocation] = useState(type?.location_kind ?? 'video');

  /*
   * The shared Modal, not a hand-rolled overlay.
   *
   * This was a bare `fixed inset-0` div, which meant it was the one dialog
   * in the app that Escape did not close, that Tab walked straight out of
   * into the page behind, that let the page underneath keep scrolling, and
   * that never joined the modal stack - so an Escape pressed over it went
   * to whatever was open behind it instead.
   */
  return (
    <Modal
      isOpen
      onClose={onCancel}
      size="sm"
      title={type ? 'Edit kind of meeting' : 'New kind of meeting'}
      description="Its colour is how you read the week at a glance. Its length is what booking one of these fills in."
      footer={
        <div className="flex w-full items-center gap-2">
          <button
            onClick={() => onSave({ name, colour, duration_minutes: minutes, location_kind: location })}
            disabled={busy || !name.trim()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--indigo)] px-3 text-body font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {type ? 'Save' : 'Create'}
          </button>
          <button onClick={onCancel} className="h-8 px-2.5 text-body text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
            Cancel
          </button>
          {onArchive && (
            <button
              onClick={onArchive}
              disabled={busy}
              title="Meetings already booked keep this colour"
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-2.5 text-body font-medium text-[var(--text-tertiary)] hover:text-rose-600 hover:border-rose-500/40 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" /> Retire
            </button>
          )}
        </div>
      }
    >
      <div>
        <label className="block text-caption font-medium text-[var(--text-secondary)]">Name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Discovery call"
          className="mt-1 h-8 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 text-strong text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
        />

        <label className="mt-3 block text-caption font-medium text-[var(--text-secondary)]">Colour</label>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {EVENT_COLOURS.map((c) => (
            <button
              key={c.hex}
              onClick={() => setColour(c.hex)}
              title={c.name}
              className={cn(
                'h-7 w-7 rounded-full transition-transform',
                colour === c.hex ? 'ring-2 ring-offset-2 ring-[var(--indigo)] ring-offset-[var(--bg-surface)]' : 'hover:scale-110',
              )}
              style={{ background: c.hex }}
            >
              {colour === c.hex && <Check className="mx-auto h-3.5 w-3.5 text-white" />}
            </button>
          ))}
        </div>

        <div className="mt-3 flex gap-3">
          <div className="flex-1">
            <label className="block text-caption font-medium text-[var(--text-secondary)]">Usually runs</label>
            <select
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className="mt-1 h-8 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-body text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
            >
              {[15, 20, 30, 45, 60, 90, 120].map((m) => (
                <option key={m} value={m}>{durationLabel(m)}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-caption font-medium text-[var(--text-secondary)]">Usually happens</label>
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value as any)}
              className="mt-1 h-8 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-body text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
            >
              {EVENT_LOCATION_KINDS.map((k) => (
                <option key={k.id} value={k.id}>{k.label}</option>
              ))}
            </select>
          </div>
        </div>

      </div>
    </Modal>
  );
}

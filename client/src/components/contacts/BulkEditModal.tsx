import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  BULK_EDIT_FIELDS, BULK_EDIT_FIELD_LABEL, BULK_EDIT_MAX, plural,
  type BulkEditField, type BulkEditInput, type Tag,
} from '@lemlist/shared';
import { contactsApi } from '../../api/contacts.api';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   One change, many contacts.

   Fixing a company name across forty imported rows meant opening forty
   records. This sets or clears one field on everybody selected, adds or
   removes tags, or sets a custom field - the server checks the field
   against the same list this offers (shared/contact-hygiene), so nothing
   here is a column name it trusts the browser with.

   No owner field: contacts have no owner yet, and a control for a column
   that does not exist would be worse than none.
   ═══════════════════════════════════════════════════════════════════════ */

type Target = BulkEditField | 'custom' | 'tags';
type Action = 'set' | 'clear' | 'add' | 'remove';

export function BulkEditModal({ ids, tags, onClose, onDone }: {
  ids: string[];
  tags: Tag[];
  onClose: () => void;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [target, setTarget] = useState<Target>('company');
  const [action, setAction] = useState<Action>('set');
  const [value, setValue] = useState('');
  const [customKey, setCustomKey] = useState('');
  const [tagIds, setTagIds] = useState<Set<string>>(new Set());

  const isTags = target === 'tags';
  const effective: Action = isTags ? (action === 'remove' ? 'remove' : 'add') : (action === 'clear' ? 'clear' : 'set');

  const edit = (): BulkEditInput | null => {
    if (isTags) return tagIds.size ? { op: effective === 'remove' ? 'remove_tags' : 'add_tags', tag_ids: [...tagIds] } : null;
    if (target === 'custom') {
      if (!customKey.trim()) return null;
      return effective === 'clear' ? { op: 'clear_custom', key: customKey.trim() } : { op: 'set_custom', key: customKey.trim(), value };
    }
    return effective === 'clear' ? { op: 'clear', field: target } : { op: 'set', field: target, value };
  };

  const blocker = ids.length > BULK_EDIT_MAX
    ? `Up to ${BULK_EDIT_MAX.toLocaleString()} contacts at a time`
    : isTags && tagIds.size === 0 ? 'Choose at least one tag'
    : target === 'custom' && !customKey.trim() ? 'Name the custom field'
    : effective === 'set' && !value.trim() ? 'Type the new value, or choose Clear'
    : null;

  const run = useMutation({
    mutationFn: () => contactsApi.bulkEdit(ids, edit()!),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['contact-companies'] });
      qc.invalidateQueries({ queryKey: ['tags'] });
      toast.success(`Updated ${plural(r.updated, 'contact')}`);
      onDone?.();
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not update them'),
  });

  const targetOptions = [
    ...BULK_EDIT_FIELDS.map((f) => ({ value: f, label: BULK_EDIT_FIELD_LABEL[f] })),
    { value: 'custom', label: 'A custom field' },
    { value: 'tags', label: 'Tags' },
  ];

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Edit ${plural(ids.length, 'contact')}`}
      description="The same change, applied to everyone selected."
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => run.mutate()} disabled={run.isPending} blockedBy={blocker}>
            {run.isPending ? 'Updating...' : `Update ${plural(ids.length, 'contact')}`}
          </Button>
        </div>
      }
    >
      <div className="space-y-3.5">
        <Select
          label="Field"
          value={target}
          onChange={(e) => { setTarget(e.target.value as Target); setAction(e.target.value === 'tags' ? 'add' : 'set'); }}
          options={targetOptions}
        />
        {target === 'custom' && (
          <Input label="Custom field name" value={customKey} maxLength={64} onChange={(e) => setCustomKey(e.target.value)} placeholder="e.g. region" />
        )}
        <div className="flex gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-0.5" role="radiogroup" aria-label="What to do">
          {(isTags ? (['add', 'remove'] as const) : (['set', 'clear'] as const)).map((a) => (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={effective === a}
              onClick={() => setAction(a)}
              className={cn(
                'flex-1 rounded-md px-2.5 py-1 text-body font-medium transition-colors',
                effective === a ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
              )}
            >
              {a === 'set' ? 'Set to' : a === 'clear' ? 'Clear it' : a === 'add' ? 'Add tags' : 'Remove tags'}
            </button>
          ))}
        </div>
        {!isTags && effective === 'set' && (
          <Input label="New value" value={value} maxLength={500} onChange={(e) => setValue(e.target.value)} autoFocus />
        )}
        {!isTags && effective === 'clear' && (
          <p className="text-caption text-[var(--text-secondary)]">
            The field is emptied on every selected contact.
          </p>
        )}
        {isTags && (
          tags.length === 0
            ? <p className="text-caption text-[var(--text-tertiary)]">No tags yet. Create one from Add tags on the toolbar.</p>
            : (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => {
                  const on = tagIds.has(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setTagIds((prev) => { const n = new Set(prev); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })}
                      className={cn(
                        'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-caption font-medium transition-colors',
                        on ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)] text-[var(--indigo-text)]' : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
                      )}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ background: t.color }} aria-hidden />
                      {t.name}
                    </button>
                  );
                })}
              </div>
            )
        )}
      </div>
    </Modal>
  );
}

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Copy, GitMerge, Users } from 'lucide-react';
import {
  DUPLICATE_REASON_LABEL, MERGE_FIELDS, MERGE_FIELD_LABEL, LIFECYCLE_LABEL,
  bestLifecycle, defaultMergeChoices, mergeFieldValues, formatDate, plural,
  type DuplicateContact, type DuplicateGroup, type MergeField,
} from '@lemlist/shared';
import { contactsApi } from '../../api/contacts.api';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { AsyncPanel } from '../ui/AsyncPanel';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   Possible duplicates, and folding them into one.

   The server finds them (find_contact_duplicates) and does the merge in a
   single database transaction (merge_contacts). This file is the part a
   person sees: which records look like the same person and why, which one
   to keep, and which value to keep for each field where they disagree.
   ═══════════════════════════════════════════════════════════════════════ */

const DUP_KEYS = [
  ['contact-duplicates'], ['contacts'], ['contact-stats'], ['contact-crm'], ['contact-engagement'],
  ['contact-timeline'], ['contact-lists'], ['contact-emails'], ['leads'],
];

function nameOf(c: Pick<DuplicateContact, 'first_name' | 'last_name' | 'email'>): string {
  return [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email;
}

/** How much history a record holds; the default primary is the busiest. */
function weight(c: DuplicateContact): number {
  const a = c.activity;
  return a ? a.campaigns + a.meetings * 3 + a.notes + a.deals * 3 : 0;
}

function defaultPrimary(contacts: DuplicateContact[]): string {
  return [...contacts].sort((a, b) =>
    weight(b) - weight(a) || new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0]?.id ?? '';
}

/* ── The merge itself ─────────────────────────────────────────────────── */

export function MergeDialog({ group, onClose, onMerged }: {
  group: DuplicateGroup;
  onClose: () => void;
  onMerged?: (primaryId: string) => void;
}) {
  const qc = useQueryClient();
  const contacts = group.contacts;
  const [primaryId, setPrimaryId] = useState(() => defaultPrimary(contacts));
  const [choices, setChoices] = useState<Partial<Record<MergeField, string>>>(() =>
    defaultMergeChoices(contacts as any, defaultPrimary(contacts)));

  // Only fields where the records actually disagree need a decision.
  const contested = useMemo(() => MERGE_FIELDS.filter((f) => {
    const values = new Set(contacts.map((c) => String((c as any)[f] ?? '').trim()).filter(Boolean));
    return values.size > 1 || (values.size === 1 && contacts.some((c) => !String((c as any)[f] ?? '').trim()));
  }), [contacts]);

  const choosePrimary = (id: string) => {
    setPrimaryId(id);
    // The address follows the record being kept unless picked by hand.
    setChoices((c) => ({ ...c, email: id }));
  };

  const merged = bestLifecycle(contacts.map((c) => c.lifecycle));
  const others = contacts.filter((c) => c.id !== primaryId).map((c) => c.id);

  const merge = useMutation({
    mutationFn: () => contactsApi.merge(primaryId, others, mergeFieldValues(contacts as any, primaryId, choices) as Record<string, string | null>),
    onSuccess: (r) => {
      for (const key of DUP_KEYS) qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ['contact', primaryId] });
      const moved = r.moved?.enrolments_collapsed
        ? ` ${plural(r.moved.enrolments_collapsed, 'shared campaign enrolment')} kept once, at the furthest step.`
        : '';
      toast.success(`Merged ${plural(r.merged, 'duplicate')} into ${nameOf(r.contact)}.${moved}`);
      onMerged?.(primaryId);
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not merge them'),
  });

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="2xl"
      title={`Merge ${contacts.length} records into one`}
      description="Everything they have - campaigns, replies, meetings, deals, notes, tags and lists - moves to the record you keep. The others are deleted. This cannot be undone."
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-caption text-[var(--text-tertiary)]">
            Stage after merging: <strong className="text-[var(--text-secondary)]">{LIFECYCLE_LABEL[merged]}</strong>
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => merge.mutate()} disabled={merge.isPending} blockedBy={others.length === 0 ? 'Choose a record to keep' : null}>
              <GitMerge className="h-3.5 w-3.5" />
              {merge.isPending ? 'Merging...' : `Merge into one`}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-separate border-spacing-0 text-left">
            <thead>
              <tr>
                <th className="w-28 pb-2 text-caption font-medium text-[var(--text-tertiary)]">Keep</th>
                {contacts.map((c) => (
                  <th key={c.id} className="pb-2 pr-3 align-top">
                    <label className="flex cursor-pointer items-start gap-2">
                      <input
                        type="radio"
                        name="merge-primary"
                        checked={primaryId === c.id}
                        onChange={() => choosePrimary(c.id)}
                        className="mt-1 accent-[var(--indigo)]"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-body font-semibold text-[var(--text-primary)]">{nameOf(c)}</span>
                        <span className="block text-caption text-[var(--text-tertiary)]">
                          Added {formatDate(c.created_at)}
                          {c.activity ? ` - ${plural(c.activity.campaigns, 'campaign')}, ${plural(c.activity.meetings, 'meeting')}` : ''}
                        </span>
                      </span>
                    </label>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {contested.map((field) => (
                <tr key={field}>
                  <td className="border-t border-[var(--border-subtle)] py-2 pr-3 text-caption font-medium text-[var(--text-secondary)]">
                    {MERGE_FIELD_LABEL[field]}
                  </td>
                  {contacts.map((c) => {
                    const value = String((c as any)[field] ?? '').trim();
                    const picked = choices[field] === c.id;
                    return (
                      <td key={c.id} className="border-t border-[var(--border-subtle)] py-1.5 pr-3">
                        <button
                          type="button"
                          disabled={!value && field === 'email'}
                          onClick={() => setChoices((prev) => ({ ...prev, [field]: c.id }))}
                          aria-pressed={picked}
                          className={cn(
                            'w-full truncate rounded-md border px-2 py-1 text-left text-body transition-colors',
                            picked
                              ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)] text-[var(--text-primary)]'
                              : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
                          )}
                          title={value || 'Empty'}
                        >
                          {value || <span className="italic text-[var(--text-tertiary)]">empty</span>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {contested.length === 0 && (
            <p className="text-caption text-[var(--text-tertiary)]">These records agree on every field; only their history differs.</p>
          )}
        </div>
        <p className="text-caption text-[var(--text-tertiary)]">
          Filled values are picked over blank ones, and the most recently edited record wins where both are filled.
          Custom fields are combined. If any of them unsubscribed or bounced, the merged record keeps that.
          Where two of them are in the same campaign, the furthest-along enrolment is kept.
        </p>
      </div>
    </Modal>
  );
}

/* ── One group, as a card ─────────────────────────────────────────────── */

export function DuplicateGroupCard({ group, onMerge, onDismiss, dismissing }: {
  group: DuplicateGroup;
  onMerge: () => void;
  onDismiss: () => void;
  dismissing?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5" data-duplicate-group>
      <div className="flex flex-wrap items-center gap-1.5">
        {group.reasons.map((r) => (
          <span key={r} className="rounded-full bg-[var(--indigo-subtle)] px-2 py-0.5 text-caption font-medium text-[var(--indigo-text)]">
            {DUPLICATE_REASON_LABEL[r]}
          </span>
        ))}
      </div>
      <ul className="mt-2.5 space-y-1">
        {group.contacts.map((c) => (
          <li key={c.id} className="flex min-w-0 items-baseline gap-2 text-body">
            <Link to={`/contacts/${c.id}`} className="truncate font-medium text-[var(--text-primary)] hover:underline">{nameOf(c)}</Link>
            <span className="truncate text-caption text-[var(--text-tertiary)]">
              {c.email}{c.company ? ` - ${c.company}` : ''}{c.lifecycle ? ` - ${LIFECYCLE_LABEL[c.lifecycle]}` : ''}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" onClick={onMerge}><GitMerge className="h-3.5 w-3.5" /> Review and merge</Button>
        <Button size="sm" variant="ghost" onClick={onDismiss} disabled={dismissing} title="Stop suggesting these as the same person">
          Not the same person
        </Button>
      </div>
    </div>
  );
}

/** Groups with the merge and dismiss wiring, for a page or a section. */
export function DuplicateGroups({ groups, onMerged }: { groups: DuplicateGroup[]; onMerged?: (primaryId: string) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<DuplicateGroup | null>(null);
  const dismiss = useMutation({
    mutationFn: (g: DuplicateGroup) => contactsApi.dismissDuplicate(g.contacts.map((c) => c.id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact-duplicates'] });
      toast.success('Got it - they will not be suggested again');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not dismiss that'),
  });
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        {groups.map((g) => (
          <DuplicateGroupCard
            key={g.key}
            group={g}
            onMerge={() => setOpen(g)}
            onDismiss={() => dismiss.mutate(g)}
            dismissing={dismiss.isPending && dismiss.variables?.key === g.key}
          />
        ))}
      </div>
      {open && <MergeDialog group={open} onClose={() => setOpen(null)} onMerged={onMerged} />}
    </>
  );
}

/* ── On the contacts page ─────────────────────────────────────────────── */

/**
 * A quiet line above the table when the account has likely duplicates.
 * Silent when there are none, and silent when the database cannot look -
 * a missing migration is the settings page's news, not this page's.
 */
export function DuplicatesBanner() {
  const { data } = useQuery({
    queryKey: ['contact-duplicates', 'count'],
    queryFn: () => contactsApi.duplicates(1),
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (!data || data.total === 0) return null;
  return (
    <Notice
      tone="info"
      icon={Copy}
      data-duplicates-banner=""
      action={<Link to="/contacts/duplicates" className="text-body font-medium text-[var(--indigo-text)] hover:underline">Review</Link>}
    >
      {plural(data.total, 'possible duplicate')} - the same person on more than one record.
    </Notice>
  );
}

/* ── On a contact's own page ──────────────────────────────────────────── */

export function ContactDuplicatesSection({ contactId, onMerged }: { contactId: string; onMerged?: (primaryId: string) => void }) {
  const q = useQuery({
    queryKey: ['contact-duplicates', 'for', contactId],
    queryFn: () => contactsApi.duplicatesFor(contactId),
    retry: false,
  });
  // Nothing to say is the usual case, so this takes no room unless it has
  // something; a failure stays inline rather than taking the page down.
  if (!q.isError && (!q.data || q.data.groups.length === 0)) return null;
  return (
    <section className="panel p-4" data-contact-duplicates>
      <h3 className="mb-2.5 flex items-center gap-2 text-strong font-semibold text-[var(--text-primary)]">
        <Users className="h-4 w-4 text-[var(--text-tertiary)]" /> Possible duplicates
      </h3>
      <AsyncPanel query={q} skeleton="list" skeletonRows={1}>
        {(d) => <DuplicateGroups groups={d.groups} onMerged={onMerged} />}
      </AsyncPanel>
    </section>
  );
}

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { crmApi } from '../../api/crm.api';
import { DEAL_STAGES } from '@lemlist/shared';
import type { DealStage } from '@lemlist/shared';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { cn } from '../../lib/utils';
import { Briefcase, CheckSquare, ExternalLink, StickyNote } from 'lucide-react';
import toast from 'react-hot-toast';

/* ═══════════════════════════════════════════════════════════════════════
   The moment a reply becomes a deal.

   Someone answers "sure, send me a time". That is the single highest-value
   event this product produces, and acting on it meant leaving the inbox,
   going to contacts, finding the person, opening the CRM, and creating a
   deal by hand — five steps at exactly the moment the flow should be
   shortest. Most people did not, and the pipeline quietly stopped
   reflecting reality.

   Everything needed already existed on both sides: inbox messages carry a
   contact_id, and the CRM resolves a contact_email to a contact on its own.
   Nothing connected them.
   ═══════════════════════════════════════════════════════════════════════ */

interface ReplyTarget {
  contactId: string | null;
  contactName: string | null;
  contactEmail: string;
  /** The reply's subject, which makes a far better deal title than "New deal". */
  subject: string | null;
  company: string | null;
}

type Sheet = 'deal' | 'task' | 'note';

/** Tomorrow morning, in the value format a date input wants. */
function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** A subject line, stripped of the Re:/Fwd: it has collected. */
function dealTitleFrom(target: ReplyTarget): string {
  const subject = (target.subject || '').replace(/^\s*(re|fwd|fw)\s*:\s*/gi, '').trim();
  const who = target.company || target.contactName || target.contactEmail;
  if (subject) return who ? `${subject} — ${who}` : subject;
  return who ? `${who}` : 'New deal';
}

export function ReplyActions({ target, compact }: { target: ReplyTarget; compact?: boolean }) {
  const qc = useQueryClient();
  const [sheet, setSheet] = useState<Sheet | null>(null);

  /*
   * What this person already has, so the bar can say "in pipeline" instead
   * of offering to create a second deal for a conversation that is already
   * one. Only asked when there is a contact to ask about.
   */
  const { data: deals } = useQuery({
    queryKey: ['crm-deals', 'for-reply', target.contactId, target.contactEmail],
    queryFn: () => crmApi.listDeals(
      target.contactId ? { contact_id: target.contactId } : { contact_email: target.contactEmail },
    ),
    enabled: !!(target.contactId || target.contactEmail),
    meta: { silentError: true },
  });

  const openDeal = (deals || []).find((d: any) => !['won', 'lost'].includes(d.stage));

  const done = (message: string) => {
    qc.invalidateQueries({ queryKey: ['crm-deals'] });
    qc.invalidateQueries({ queryKey: ['crm-tasks'] });
    qc.invalidateQueries({ queryKey: ['crm-notes'] });
    qc.invalidateQueries({ queryKey: ['crm-summary'] });
    toast.success(message);
    setSheet(null);
  };

  const createDeal = useMutation({
    mutationFn: (input: { title: string; value: number; stage: DealStage }) =>
      crmApi.createDeal({
        title: input.title,
        value: input.value,
        stage: input.stage,
        contact_id: target.contactId || undefined,
        contact_email: target.contactEmail,
        contact_name: target.contactName || undefined,
        company: target.company || undefined,
        notes: target.subject ? `Opened from the reply “${target.subject}”.` : undefined,
      }),
    onSuccess: () => done('Deal created'),
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not create the deal'),
  });

  const createTask = useMutation({
    mutationFn: (input: { title: string; due: string }) =>
      crmApi.createTask({
        title: input.title,
        due_date: input.due || null,
        type: 'follow_up',
        contact_id: target.contactId || undefined,
        contact_name: target.contactName || target.contactEmail,
        deal_id: openDeal?.id || undefined,
      }),
    onSuccess: () => done('Task added'),
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not add the task'),
  });

  const createNote = useMutation({
    mutationFn: (body: string) =>
      crmApi.createNote({
        body,
        contact_id: target.contactId || undefined,
        deal_id: openDeal?.id || undefined,
      }),
    onSuccess: () => done('Note saved'),
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save the note'),
  });

  return (
    <>
      <div className={cn('flex flex-wrap items-center gap-1.5', compact && 'gap-1')}>
        {openDeal ? (
          <Link
            to="/deals"
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-[11.5px] font-semibold text-emerald-600 transition-opacity hover:opacity-80 dark:text-emerald-400"
            title={`Already in the pipeline as “${openDeal.title}”`}
          >
            <Briefcase className="h-3 w-3" />
            In pipeline
            <ExternalLink className="h-2.5 w-2.5 opacity-70" />
          </Link>
        ) : (
          <ActionButton icon={Briefcase} label="Create deal" onClick={() => setSheet('deal')} primary />
        )}
        <ActionButton icon={CheckSquare} label="Add task" onClick={() => setSheet('task')} />
        <ActionButton icon={StickyNote} label="Note" onClick={() => setSheet('note')} />
      </div>

      {sheet === 'deal' && (
        <DealSheet
          target={target}
          busy={createDeal.isPending}
          onClose={() => setSheet(null)}
          onSubmit={(v) => createDeal.mutate(v)}
        />
      )}
      {sheet === 'task' && (
        <TaskSheet
          target={target}
          busy={createTask.isPending}
          onClose={() => setSheet(null)}
          onSubmit={(v) => createTask.mutate(v)}
        />
      )}
      {sheet === 'note' && (
        <NoteSheet
          target={target}
          busy={createNote.isPending}
          onClose={() => setSheet(null)}
          onSubmit={(v) => createNote.mutate(v)}
        />
      )}
    </>
  );
}

function ActionButton({
  icon: Icon, label, onClick, primary,
}: { icon: typeof Briefcase; label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors',
        primary
          ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)] hover:bg-[rgba(91,91,245,0.14)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]',
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}

function DealSheet({
  target, busy, onClose, onSubmit,
}: {
  target: ReplyTarget;
  busy: boolean;
  onClose: () => void;
  onSubmit: (v: { title: string; value: number; stage: DealStage }) => void;
}) {
  // Prefilled from the thread, because the point is not to make someone
  // retype what is already on the screen in front of them.
  const [title, setTitle] = useState(dealTitleFrom(target));
  const [value, setValue] = useState('');
  const [stage, setStage] = useState<DealStage>('qualified');

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="sm"
      title="Create a deal"
      description={`Linked to ${target.contactName || target.contactEmail}.`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            onClick={() => onSubmit({ title: title.trim(), value: Number(value) || 0, stage })}
            disabled={busy || !title.trim()}
          >
            {busy ? 'Creating…' : 'Create deal'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Value">
            <Input
              type="number"
              min="0"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0"
            />
          </Field>
          <Field label="Stage">
            <Select
              value={stage}
              onChange={(e) => setStage(e.target.value as DealStage)}
              options={DEAL_STAGES.map((s) => ({ value: s.id, label: s.label }))}
            />
          </Field>
        </div>
        {/* Qualified rather than lead: they replied. That is the whole
            difference between the two stages, and defaulting to lead would
            make every reply-sourced deal need an immediate edit. */}
        <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          Starting at Qualified because they replied — move it back if this one is earlier than that.
        </p>
      </div>
    </Modal>
  );
}

function TaskSheet({
  target, busy, onClose, onSubmit,
}: {
  target: ReplyTarget;
  busy: boolean;
  onClose: () => void;
  onSubmit: (v: { title: string; due: string }) => void;
}) {
  const [title, setTitle] = useState(`Follow up with ${target.contactName || target.contactEmail}`);
  const [due, setDue] = useState(tomorrow());

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="sm"
      title="Add a task"
      description={`Linked to ${target.contactName || target.contactEmail}.`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => onSubmit({ title: title.trim(), due })} disabled={busy || !title.trim()}>
            {busy ? 'Adding…' : 'Add task'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Task">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <Field label="Due">
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function NoteSheet({
  target, busy, onClose, onSubmit,
}: {
  target: ReplyTarget;
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: string) => void;
}) {
  const [body, setBody] = useState('');

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="sm"
      title="Add a note"
      description={`On ${target.contactName || target.contactEmail}.`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => onSubmit(body.trim())} disabled={busy || !body.trim()}>
            {busy ? 'Saving…' : 'Save note'}
          </Button>
        </div>
      }
    >
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={5}
        autoFocus
        placeholder="What came out of this conversation…"
        className="w-full resize-y rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-[13px] leading-relaxed text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--indigo)]"
      />
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-semibold text-[var(--text-secondary)]">{label}</span>
      {children}
    </label>
  );
}

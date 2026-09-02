import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Clock, Ban, Check, Loader2, ArrowRight } from 'lucide-react';
import { TRIAGE_DECISIONS, type TriageDecision, type TriageResult } from '@lemlist/shared';
import { inboxApi } from '../../api/inbox.api';
import { TriageQuestion } from './TriageQuestion';
import { acceptsShortcut } from '../../lib/keyboard';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

/* ═══════════════════════════════════════════════════════════════════════
   Deciding what a reply is, without leaving the reply.

   This is the hinge of the product and until now nothing happened at it: a
   lifecycle moved quietly and the moment passed. The Leads inbox was empty
   because nothing filled it.

   Three decisions and no more. Two of them are one keystroke; the third
   asks a single question first, because "not interested" is worth a reason
   and because suppressing somebody by accident is the one mistake here that
   cannot be undone from this screen.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * How a decision reads when it is being recalled rather than just made.
 *
 * Split in two because this bar lives in a 240px rail, and one long sentence
 * came out as "Marked not interested - they ar…". A settled state that
 * cannot say what it settled is no better than no settled state: the whole
 * point is not having to go and check.
 */
const SETTLED_LABEL: Record<TriageDecision, { title: string; detail: string }> = {
  interested: { title: 'Marked interested', detail: 'A lead exists for this thread.' },
  later: { title: 'Marked for later', detail: 'A follow-up is scheduled.' },
  not_interested: { title: 'Marked not interested', detail: 'They are suppressed, so no campaign reaches them.' },
};

const ICON: Record<TriageDecision, React.ElementType> = {
  interested: Sparkles,
  later: Clock,
  not_interested: Ban,
};

export function ReplyTriage({ messageId, contactId, decision, leadId }: {
  messageId: string;
  contactId?: string | null;
  /** What the message already says it is, from the server. */
  decision?: TriageDecision | null;
  /** What that decision created, when it was a lead. */
  leadId?: string | null;
}) {
  const qc = useQueryClient();
  /** Which decision is mid-question. Null means the bar is at rest. */
  const [asking, setAsking] = useState<'later' | 'not_interested' | null>(null);
  const [done, setDone] = useState<TriageResult | null>(null);

  /*
   * A thread that was already decided shows its decision, from the message
   * rather than from this component's memory. Without it a reload put an
   * answered reply back at the start, offering to decide it a second time -
   * which is the difference between a demo and a feature.
   */
  const settled: TriageResult | null = done ?? (decision
    ? { decision, lead_id: leadId ?? undefined, message: SETTLED_LABEL[decision].title }
    : null);

  // A new message is a new decision: without this the bar would still be
  // showing the last thread's outcome while you read the next one.
  useEffect(() => { setDone(null); setAsking(null); }, [messageId]);

  const triage = useMutation({
    mutationFn: (input: any) => inboxApi.triage(messageId, input),
    onSuccess: (result) => {
      setDone(result);
      setAsking(null);
      qc.invalidateQueries({ queryKey: ['inbox'] });
      // Everything a decision touches, so the Leads inbox and the task list
      // reflect it without a reload.
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['crm'] });
      qc.invalidateQueries({ queryKey: ['suppression'] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
      toast.success(result.message);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not record that'),
  });

  const undo = useMutation({
    mutationFn: () => inboxApi.untriage(messageId),
    onSuccess: (r) => {
      setDone(null);
      qc.invalidateQueries({ queryKey: ['inbox'] });
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['crm'] });
      qc.invalidateQueries({ queryKey: ['suppression'] });
      toast.success(r.message);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not undo that'),
  });

  const choose = (decision: TriageDecision) => {
    if (decision === 'interested') { triage.mutate({ decision }); return; }
    // The other two ask first: a snooze needs a length, and a suppression
    // is the one action here you cannot take back from this screen.
    setAsking(decision);
  };

  /*
   * i / l / n, guarded like every other shortcut in the app so they never
   * fire while somebody is typing a reply. Off entirely once a decision is
   * made, so a stray keypress cannot re-triage a thread.
   */
  useEffect(() => {
    if (settled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!acceptsShortcut(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const match = TRIAGE_DECISIONS.find((d) => d.key === e.key.toLowerCase());
      if (!match) return;
      e.preventDefault();
      choose(match.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // `settled`, not `done`: a thread the server already says is decided must
    // not have live keys either, and depending on `done` alone left them bound
    // on every reply that arrived already triaged.
  }, [settled, messageId]);

  if (settled) {
    const copy = SETTLED_LABEL[settled.decision];
    return (
      <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2.5">
        <div className="flex items-start gap-2">
          <Check className="mt-[3px] h-3.5 w-3.5 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-semibold leading-tight text-[var(--text-primary)]">
              {settled.message}
            </p>
            {/* Wraps rather than truncates: what a decision did is the whole
                reason for showing that one was made. */}
            <p className="mt-0.5 text-[11px] leading-snug text-[var(--text-tertiary)]">
              {copy.detail}
            </p>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-3 pl-[22px]">
          <button
            onClick={() => undo.mutate()}
            disabled={undo.isPending}
            className="text-[11.5px] font-medium text-[var(--text-tertiary)] underline decoration-dotted underline-offset-2 hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            {undo.isPending ? 'Undoing…' : 'Undo'}
          </button>
          {settled.lead_id && (
            <Link
              to="/leads/inbox"
              className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--indigo)] hover:underline"
            >
              Open in Leads <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>
    );
  }

  if (asking) {
    return (
      <TriageQuestion
        kind={asking}
        pending={triage.isPending}
        onAnswer={(answer) => triage.mutate({ decision: asking, ...answer })}
        onCancel={() => setAsking(null)}
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2.5">
      <span className="text-[11.5px] font-medium text-[var(--text-tertiary)]">What is this?</span>
      {TRIAGE_DECISIONS.map((d) => {
        const Icon = ICON[d.id];
        // Making a lead needs somebody to make it about; the server refuses
        // otherwise, so the button says why rather than failing on press.
        const blocked = d.id === 'interested' && !contactId;
        return (
          <button
            key={d.id}
            onClick={() => choose(d.id)}
            disabled={triage.isPending || blocked}
            title={blocked
              ? 'This thread is not linked to a contact yet, so there is nobody to make a lead about.'
              : d.effect}
            className={cn(
              'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
              d.id === 'interested'
                ? 'bg-[var(--indigo)] text-white hover:opacity-90'
                : 'border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
            )}
          >
            {triage.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
            {d.label}
            <kbd className={cn(
              'ml-0.5 rounded px-1 text-[10px] font-semibold leading-[15px]',
              d.id === 'interested' ? 'bg-white/20 text-white' : 'bg-[var(--bg-surface)] text-[var(--text-muted)]',
            )}>
              {d.key.toUpperCase()}
            </kbd>
          </button>
        );
      })}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Clock, Ban, Check, Loader2, ArrowRight } from 'lucide-react';
import {
  TRIAGE_DECISIONS, SNOOZE_CHOICES, NOT_INTERESTED_REASONS,
  type TriageDecision, type TriageResult,
} from '@lemlist/shared';
import { inboxApi } from '../../api/inbox.api';
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

const ICON: Record<TriageDecision, React.ElementType> = {
  interested: Sparkles,
  later: Clock,
  not_interested: Ban,
};

export function ReplyTriage({ messageId, contactId }: { messageId: string; contactId?: string | null }) {
  const qc = useQueryClient();
  /** Which decision is mid-question. Null means the bar is at rest. */
  const [asking, setAsking] = useState<'later' | 'not_interested' | null>(null);
  const [done, setDone] = useState<TriageResult | null>(null);

  // A new message is a new decision: without this the bar would still be
  // showing the last thread's outcome while you read the next one.
  useEffect(() => { setDone(null); setAsking(null); }, [messageId]);

  const triage = useMutation({
    mutationFn: (input: any) => inboxApi.triage(messageId, input),
    onSuccess: (result) => {
      setDone(result);
      setAsking(null);
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
    if (done) return;
    const onKey = (e: KeyboardEvent) => {
      if (!acceptsShortcut(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const match = TRIAGE_DECISIONS.find((d) => d.key === e.key.toLowerCase());
      if (!match) return;
      e.preventDefault();
      choose(match.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [done, messageId]);

  if (done) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2.5">
        <Check className="h-3.5 w-3.5 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--text-primary)]">
          {done.message}
        </span>
        {done.lead_id && (
          <Link
            to="/leads/inbox"
            className="inline-flex flex-shrink-0 items-center gap-1 text-[11.5px] font-semibold text-[var(--indigo)] hover:underline"
          >
            Open in Leads <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>
    );
  }

  if (asking === 'later') {
    return (
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2.5">
        <p className="mb-2 text-[11.5px] font-medium text-[var(--text-secondary)]">Come back to this when?</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {SNOOZE_CHOICES.map((c) => (
            <button
              key={c.id}
              onClick={() => triage.mutate({ decision: 'later', snooze_days: c.days })}
              disabled={triage.isPending}
              className="h-7 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 text-[11.5px] font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--indigo)] disabled:opacity-50"
            >
              {c.label}
            </button>
          ))}
          <button onClick={() => setAsking(null)} className="h-7 px-2 text-[11.5px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (asking === 'not_interested') {
    return (
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2.5">
        <p className="mb-0.5 text-[11.5px] font-medium text-[var(--text-secondary)]">Why not?</p>
        <p className="mb-2 text-[10.5px] text-[var(--text-tertiary)]">
          They will be suppressed, so no campaign reaches them again.
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {NOT_INTERESTED_REASONS.map((r) => (
            <button
              key={r.id}
              onClick={() => triage.mutate({ decision: 'not_interested', reason: r.id })}
              disabled={triage.isPending}
              className="h-7 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 text-[11.5px] font-medium text-[var(--text-primary)] transition-colors hover:border-rose-500/50 disabled:opacity-50"
            >
              {r.label}
            </button>
          ))}
          <button onClick={() => setAsking(null)} className="h-7 px-2 text-[11.5px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
            Cancel
          </button>
        </div>
      </div>
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

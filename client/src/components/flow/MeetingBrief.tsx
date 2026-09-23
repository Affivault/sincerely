/* ═══════════════════════════════════════════════════════════════════════
   The meeting loop: a brief before, an outcome after.

   Before: who they are, where the deal stands, what they said, what they
   pushed back on, how the last call went. After: one line on how it went,
   and the moves that usually follow - advance the deal, set the follow-up -
   done from the same card instead of four pages.
   ═══════════════════════════════════════════════════════════════════════ */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  AlertTriangle, ArrowDownLeft, ArrowUpRight, Briefcase, Building2, CalendarClock, CheckCircle2,
  ExternalLink, Handshake, ListChecks, Loader2, MessageSquare, Video,
} from 'lucide-react';
import { DEAL_STAGES, formatDate, type DealStage } from '@lemlist/shared';
import { briefApi } from '../../api/flow.api';
import { crmApi } from '../../api/crm.api';
import { formatRelativeTime } from '../../lib/utils';
import { DealHealthDot } from '../crm/DealHealth';

function money(v: number, currency: string): string {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(v); }
  catch { return `${currency} ${Math.round(v)}`; }
}

function Section({ icon: Icon, title, children }: { icon: typeof Briefcase; title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-micro font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        <Icon className="h-3 w-3" />{title}
      </p>
      {children}
    </div>
  );
}

export function MeetingBrief({ eventId }: { eventId: string }) {
  const { data: b, isLoading, isError } = useQuery({
    queryKey: ['meeting-brief', eventId],
    queryFn: () => briefApi.get(eventId),
    staleTime: 60_000,
  });

  if (isLoading) {
    return <div className="flex items-center gap-2 py-3 text-body text-[var(--text-tertiary)]"><Loader2 className="h-4 w-4 animate-spin" /> Putting the brief together...</div>;
  }
  if (isError || !b) {
    return <p className="py-2 text-body text-[var(--text-tertiary)]">The brief could not be loaded. Open the meeting from the calendar instead.</p>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-4">
        {b.person && (
          <Section icon={Briefcase} title="Who">
            <p className="text-body font-medium text-[var(--text-primary)]">
              {b.person.contact_id
                ? <Link to={`/contacts/${b.person.contact_id}`} className="hover:underline">{b.person.name || b.person.email}</Link>
                : (b.person.name || b.person.email)}
            </p>
            <p className="text-caption text-[var(--text-tertiary)]">
              {[b.person.job_title, b.person.company].filter(Boolean).join(' at ') || b.person.email}
            </p>
            {b.person.linkedin_url && (
              <a href={b.person.linkedin_url} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-caption text-[var(--indigo)] hover:underline">
                LinkedIn <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </Section>
        )}

        {b.deal ? (
          <Section icon={Handshake} title="Deal">
            <Link to={`/deals/${b.deal.id}`} className="flex items-center gap-1.5 text-body font-medium text-[var(--text-primary)] hover:underline">
              <DealHealthDot health={b.deal.health} />{b.deal.title}
            </Link>
            <p className="text-caption text-[var(--text-tertiary)]">
              {DEAL_STAGES.find((s) => s.id === b.deal!.stage)?.label || b.deal.stage} · {money(b.deal.value, b.deal.currency)}
              {b.deal.expected_close_date && ` · closes ${formatDate(b.deal.expected_close_date)}`}
            </p>
            {b.deal.health && b.deal.health.reasons.filter((r) => r.impact < 0).slice(0, 2).map((r, i) => (
              <p key={i} className="mt-0.5 text-caption text-amber-600 dark:text-amber-400">{r.text}</p>
            ))}
          </Section>
        ) : (
          <Section icon={Handshake} title="Deal">
            <p className="text-caption text-[var(--text-tertiary)]">No open deal with them yet.</p>
          </Section>
        )}

        {b.previous_meetings.length > 0 && (
          <Section icon={CalendarClock} title="Last time">
            <ul className="space-y-1">
              {b.previous_meetings.map((m, i) => (
                <li key={i} className="text-caption text-[var(--text-secondary)]">
                  <span className="text-[var(--text-tertiary)]">{formatDate(m.at)}:</span>{' '}
                  {m.outcome || <span className="italic text-[var(--text-tertiary)]">no notes</span>}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {b.open_tasks.length > 0 && (
          <Section icon={ListChecks} title="Still open">
            <ul className="space-y-0.5">
              {b.open_tasks.map((t, i) => <li key={i} className="text-caption text-[var(--text-secondary)]">{t.title}</li>)}
            </ul>
          </Section>
        )}
      </div>

      <div className="space-y-4">
        {b.objections.length > 0 && (
          <Section icon={AlertTriangle} title="What they pushed back on">
            <ul className="space-y-1.5">
              {b.objections.map((o, i) => (
                <li key={i} className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-2.5 py-1.5 text-caption text-[var(--text-secondary)]">
                  "{o.snippet}"
                </li>
              ))}
            </ul>
          </Section>
        )}
        <Section icon={MessageSquare} title="Recent email">
          {b.emails.length === 0 ? (
            <p className="text-caption text-[var(--text-tertiary)]">No email with them in the inbox.</p>
          ) : (
            <ul className="space-y-1.5">
              {b.emails.map((m, i) => (
                <li key={i} className="flex gap-1.5 text-caption">
                  {m.direction === 'inbound'
                    ? <ArrowDownLeft className="mt-0.5 h-3 w-3 flex-shrink-0 text-emerald-500" />
                    : <ArrowUpRight className="mt-0.5 h-3 w-3 flex-shrink-0 text-[var(--text-muted)]" />}
                  <span className="min-w-0">
                    <span className="text-[var(--text-tertiary)]">{formatRelativeTime(m.at)} · </span>
                    <span className="text-[var(--text-secondary)] line-clamp-2">{m.snippet || m.subject}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        {b.event.notes && (
          <Section icon={Building2} title="Meeting notes">
            <p className="whitespace-pre-wrap text-caption text-[var(--text-secondary)]">{b.event.notes}</p>
          </Section>
        )}
        {b.event.conferencing_url && (
          <a href={b.event.conferencing_url} target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[var(--indigo)] text-white text-body font-medium hover:opacity-90">
            <Video className="h-3.5 w-3.5" /> Join
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * After the call: how it went, and the usual next moves in the same place.
 * `onDone` fires once the outcome is saved.
 */
export function MeetingOutcome({ eventId, onDone }: { eventId: string; onDone?: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [advance, setAdvance] = useState(true);
  const [followUp, setFollowUp] = useState(true);
  // The brief already knows the deal and the person; no second lookup.
  const { data: b } = useQuery({
    queryKey: ['meeting-brief', eventId],
    queryFn: () => briefApi.get(eventId),
    staleTime: 60_000,
  });
  const dealId = b?.deal?.id || null;
  const contactName = b?.person?.name || null;
  const order: DealStage[] = ['lead', 'qualified', 'proposal'];
  const idx = b?.deal ? order.indexOf(b.deal.stage as DealStage) : -1;
  const next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;

  const save = useMutation({
    mutationFn: async () => {
      await crmApi.updateEvent(eventId, { outcome: text.trim() });
      if (dealId && next && advance) await crmApi.updateDeal(dealId, { stage: next } as any);
      if (followUp) {
        await crmApi.createTask({
          title: `Follow up${contactName ? ` with ${contactName}` : ''} after the call`,
          due_date: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          priority: 'high',
          deal_id: dealId || null,
          contact_name: contactName || null,
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm'] });
      qc.invalidateQueries({ queryKey: ['flow'] });
      toast.success('Outcome saved');
      onDone?.();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save the outcome'),
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (text.trim()) save.mutate(); }}
      className="space-y-2.5"
      onClick={(e) => e.stopPropagation()}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        autoFocus
        placeholder="How did it go? Next steps, objections, who else needs to be involved..."
        className="w-full resize-y rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-body text-[var(--text-primary)] focus:border-[var(--indigo)] focus:outline-none focus:ring-2 focus:ring-[var(--indigo-subtle)]"
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) { e.preventDefault(); save.mutate(); } }}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-caption text-[var(--text-secondary)]">
        {dealId && next && (
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={advance} onChange={(e) => setAdvance(e.target.checked)} />
            Move the deal to {DEAL_STAGES.find((s) => s.id === next)?.label}
          </label>
        )}
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} />
          Follow-up task in 2 days
        </label>
        <span className="flex-1" />
        <button
          type="submit"
          disabled={!text.trim() || save.isPending}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[var(--indigo)] text-white text-body font-medium hover:opacity-90 disabled:opacity-50"
        >
          {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          Save outcome
        </button>
      </div>
    </form>
  );
}

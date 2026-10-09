import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CheckCircle2, Circle, FlaskConical, Pencil, RotateCcw, Sparkles, X } from 'lucide-react';
import {
  IMPROVE, IMPROVE_ELEMENT_LABELS, runningLine,
  type Experiment, type ImproveStatus,
} from '@lemlist/shared';
import { campaignsApi } from '../../api/campaigns.api';
import { Button } from '../ui/Button';
import { Toggle } from '../ui/Toggle';
import { RichTextEditor } from '../ui/RichTextEditor';
import { cn, formatRelativeTime } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   "Let Relay improve this campaign."

   One switch. Then this card says, in sentences, what Relay wants to try
   (with the original and the new version side by side), how a test is
   going, and what it has learned - nothing to configure, no variants or
   p-values to read. Approve / Edit / Skip, or let it run without asking.
   ═══════════════════════════════════════════════════════════════════════ */

function plain(html: string | null | undefined): string {
  return (html || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();
}

/** The sentences of `after` that are not in `before`, for highlighting what changed. */
function changedSentences(before: string, after: string): Set<string> {
  const split = (t: string) => t.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  const had = new Set(split(before));
  return new Set(split(after).filter((x) => !had.has(x)));
}

function Version({ label, e, which }: { label: string; e: Experiment; which: 'original' | 'challenger' }) {
  const v = e[which];
  const other = which === 'challenger' ? e.original : e.challenger;
  if (e.element === 'subject') {
    return (
      <div className={cn('min-w-0 rounded-xl border px-3 py-2.5', which === 'challenger' ? 'border-[rgba(91,91,245,0.35)] bg-[var(--indigo-subtle)]' : 'border-[var(--border-subtle)] bg-[var(--bg-app)]')}>
        <p className="text-micro font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
        <p className="mt-1 text-body font-medium text-[var(--text-primary)]">{v.subject || e.original.subject}</p>
      </div>
    );
  }
  const text = plain(v.body_html);
  const fresh = which === 'challenger' ? changedSentences(plain(other.body_html), text) : new Set<string>();
  const changedBefore = which === 'original' ? changedSentences(plain(e.challenger.body_html), text) : new Set<string>();
  return (
    <div className={cn('min-w-0 rounded-xl border px-3 py-2.5', which === 'challenger' ? 'border-[rgba(91,91,245,0.35)] bg-[var(--indigo-subtle)]' : 'border-[var(--border-subtle)] bg-[var(--bg-app)]')}>
      <p className="text-micro font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
      <div className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap text-caption leading-relaxed text-[var(--text-secondary)]">
        {text.split(/(?<=[.!?])\s+|(\n+)/).filter((x) => x !== undefined && x !== '').map((part, i) => {
          if (/^\n+$/.test(part)) return <span key={i}>{part}</span>;
          const t = part.trim();
          const mark = fresh.has(t) || changedBefore.has(t);
          return (
            <span key={i} className={cn(mark && (which === 'challenger'
              ? 'rounded bg-[var(--indigo)]/15 font-medium text-[var(--text-primary)]'
              : 'rounded bg-[var(--bg-hover)] line-through decoration-[var(--text-muted)]'))}
            >{part}{' '}</span>
          );
        })}
      </div>
    </div>
  );
}

export function ImproveCard({ campaignId }: { campaignId: string }) {
  const qc = useQueryClient();
  const key = ['campaign', campaignId, 'improve'];
  const { data } = useQuery({ queryKey: key, queryFn: () => campaignsApi.improve(campaignId), staleTime: 30_000, meta: { silentError: true } });
  const set = (next: ImproveStatus) => qc.setQueryData(key, next);
  const fail = (err: any) => toast.error(err?.response?.data?.error || 'That did not work. Try again in a moment.');

  const configure = useMutation({ mutationFn: (p: { enabled?: boolean; auto?: boolean }) => campaignsApi.setImprove(campaignId, p), onSuccess: set, onError: fail });
  const approve = useMutation({
    mutationFn: (v: { id: string; edits?: { subject?: string; body_html?: string } }) => campaignsApi.approveTest(campaignId, v.id, v.edits),
    onSuccess: (next) => { set(next); toast.success('Test started. The rest of the sends split between the two versions.'); },
    onError: fail,
  });
  const stop = useMutation({ mutationFn: (id: string) => campaignsApi.stopTest(campaignId, id), onSuccess: set, onError: fail });
  const undo = useMutation({
    mutationFn: (id: string) => campaignsApi.undoTest(campaignId, id),
    onSuccess: (next) => { set(next); toast.success('The original is back.'); },
    onError: fail,
  });

  if (!data) return null;
  const busy = configure.isPending || approve.isPending || stop.isPending || undo.isPending;

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]" data-improve={data.enabled ? (data.current?.status || 'idle') : 'off'}>
      <div className="flex items-start gap-3 px-4 py-3.5">
        <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] text-[var(--indigo)]">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-strong font-semibold text-[var(--text-primary)]">Let Relay improve this campaign</p>
          <p className="mt-0.5 text-caption leading-relaxed text-[var(--text-tertiary)]">
            Relay tests one change at a time - a subject line, an opening line or the closing question - against your version, judges them on replies, and keeps the new one only when it is clearly better.
          </p>
        </div>
        <Toggle
          checked={data.enabled}
          disabled={!data.ready || busy}
          onChange={(v) => configure.mutate({ enabled: v })}
          aria-label="Let Relay improve this campaign"
        />
      </div>

      {!data.ready && (
        <p className="border-t border-[var(--border-subtle)] px-4 py-2.5 text-caption text-[var(--text-tertiary)]">Run migration 082 to switch this on.</p>
      )}

      {data.enabled && (
        <div className="space-y-3 border-t border-[var(--border-subtle)] px-4 py-3.5">
          {data.current?.status === 'proposed' && (
            <Proposal key={data.current.id} e={data.current} busy={busy}
              onApprove={(edits) => approve.mutate({ id: data.current!.id, edits })}
              onSkip={() => stop.mutate(data.current!.id)} />
          )}
          {data.current?.status === 'running' && <Running e={data.current} busy={busy} onStop={() => stop.mutate(data.current!.id)} />}
          {!data.current && data.waiting && <p className="text-body text-[var(--text-secondary)]" data-improve-waiting>{data.waiting}</p>}

          <label className="flex items-center gap-2.5 text-caption text-[var(--text-secondary)]">
            <Toggle size="sm" checked={data.auto} disabled={busy} onChange={(v) => configure.mutate({ auto: v })} aria-label="Run tests without asking me first" />
            <span>Run new tests without asking me first</span>
          </label>
        </div>
      )}

      {data.history.length > 0 && (
        <div className="border-t border-[var(--border-subtle)]" data-improve-history>
          <p className="px-4 pt-3 text-caption font-semibold uppercase tracking-wider text-[var(--text-muted)]">What Relay has learned</p>
          <ul className="divide-y divide-[var(--border-subtle)]">
            {data.history.filter((h) => h.summary || h.status === 'skipped').slice(0, 8).map((h) => (
              <li key={h.id} className="flex items-start gap-2.5 px-4 py-2.5">
                {h.status === 'won' ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
                  : h.status === 'undone' ? <RotateCcw className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--text-muted)]" />
                    : <Circle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--text-muted)]" />}
                <div className="min-w-0 flex-1">
                  <p className="text-body text-[var(--text-primary)]">
                    {h.status === 'skipped' ? `You skipped a new ${IMPROVE_ELEMENT_LABELS[h.element]} for email ${h.email_number}.` : h.summary}
                    {h.status === 'undone' && ' You put the original back.'}
                  </p>
                  <p className="text-micro text-[var(--text-muted)]">{formatRelativeTime(h.decided_at || h.created_at)}</p>
                </div>
                {h.status === 'won' && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => undo.mutate(h.id)}>
                    <RotateCcw className="h-3.5 w-3.5" /> Undo
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Proposal({ e, busy, onApprove, onSkip }: {
  e: Experiment; busy: boolean;
  onApprove: (edits?: { subject?: string; body_html?: string }) => void;
  onSkip: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(e.challenger.subject || '');
  const [body, setBody] = useState(e.challenger.body_html || '');
  const empty = editing && (e.element === 'subject' ? !subject.trim() : !plain(body));
  return (
    <div className="space-y-3" data-improve-proposal>
      <div>
        <p className="text-body font-semibold text-[var(--text-primary)]">
          Relay wants to test a new {IMPROVE_ELEMENT_LABELS[e.element]} on email {e.email_number}
        </p>
        {e.why && <p className="mt-0.5 text-body text-[var(--text-secondary)]">{e.why}</p>}
      </div>
      {editing ? (
        e.element === 'subject' ? (
          <div>
            <input
              value={subject}
              onChange={(ev) => setSubject(ev.target.value)}
              maxLength={80}
              aria-label="New subject line"
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2 text-body text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
            />
            <p className="mt-1 text-right text-micro tabular-nums text-[var(--text-muted)]" data-improve-count>{subject.length}/80</p>
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--border-subtle)]">
            <RichTextEditor initialContent={e.challenger.body_html || ''} onChange={(html) => setBody(html)} minHeight="160px" bare />
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
          <Version label="Yours" e={e} which="original" />
          <Version label="Relay's" e={e} which="challenger" />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || empty} onClick={() => onApprove(editing ? (e.element === 'subject' ? { subject } : { body_html: body }) : undefined)}>
          <FlaskConical className="h-3.5 w-3.5" /> {editing ? 'Start test with my edit' : 'Approve and start test'}
        </Button>
        {!editing && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={editing ? () => setEditing(false) : onSkip}>
          <X className="h-3.5 w-3.5" /> {editing ? 'Cancel edit' : 'Skip'}
        </Button>
        <span className="text-caption text-[var(--text-tertiary)]">Nothing changes until you approve. Half the next sends get each version.</span>
      </div>
    </div>
  );
}

function Running({ e, busy, onStop }: { e: Experiment; busy: boolean; onStop: () => void }) {
  const done = Math.min(e.a.sent, e.b.sent);
  const progress = Math.min(1, done / IMPROVE.MIN_ARM);
  const rate = (x: { sent: number; replies: number }) => (x.sent ? `${((x.replies / x.sent) * 100).toFixed(1)}%` : '-');
  const early = done < IMPROVE.MIN_ARM;
  return (
    <div className="space-y-2.5" data-improve-running>
      <p className="text-body font-semibold text-[var(--text-primary)]">{runningLine(e)}</p>
      {e.why && <p className="text-caption text-[var(--text-tertiary)]">{e.why}</p>}
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-hover)]" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Test progress">
        <div className="h-full rounded-full bg-[var(--indigo)] transition-[width]" style={{ width: `${Math.max(progress * 100, done ? 3 : 0)}%` }} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-[var(--text-secondary)]">
        <span>Yours: <strong className="tabular-nums text-[var(--text-primary)]">{rate(e.a)}</strong> replied ({e.a.sent.toLocaleString()} sent)</span>
        <span>Relay's: <strong className="tabular-nums text-[var(--text-primary)]">{rate(e.b)}</strong> replied ({e.b.sent.toLocaleString()} sent)</span>
        {early && done > 0 && <span className="text-[var(--text-muted)]">Too early to read anything into these.</span>}
        <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={onStop}>Stop test</Button>
      </div>
    </div>
  );
}

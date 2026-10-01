import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CheckCircle2, Circle, Loader2, MailCheck, PlayCircle, XCircle } from 'lucide-react';
import {
  REPLY_CHECK_STAGES, REPLY_CHECK_STAGE_LABELS,
  type ReplyCheckResult, type ReplyCheckStatus,
} from '@lemlist/shared';
import { systemApi } from '../../api/system.api';
import { Button } from '../ui/Button';
import { Toggle } from '../ui/Toggle';
import { cn, formatRelativeTime } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   Does a reply really stop a sequence?

   The last proof, stage by stage, and a button to prove it again. While a
   check runs the stages light up on a clock - honest about where it is
   likely to be, since the server only answers when it is done - and the
   real result replaces them.
   ═══════════════════════════════════════════════════════════════════════ */

/** Roughly when each stage happens, for the running display. */
const EXPECTED_S = [3, 6, 30, 32, 33];

export function ReplyCheckCard({ status, run }: {
  status: ReplyCheckStatus;
  /** Started from "Run checks" on the page as well as from here. */
  run: { isPending: boolean; data?: ReplyCheckResult; mutate: () => void };
}) {
  const qc = useQueryClient();
  const [elapsed, setElapsed] = useState(0);
  const daily = useMutation({
    mutationFn: systemApi.setReplyCheckDaily,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['system-status'] }),
    onError: (err: any) => toast.error(err?.response?.data?.error || 'The setting could not be changed.'),
  });

  const running = run.isPending || status.running;
  useEffect(() => {
    if (!running) { setElapsed(0); return; }
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [running]);

  const r = run.data ?? status.last;
  const reached = new Set(running ? REPLY_CHECK_STAGES.filter((_, i) => elapsed >= EXPECTED_S[i]) : r?.reached ?? []);
  const tone = running ? 'running' : !r ? 'none' : r.skipped ? 'skipped' : r.ok ? 'ok' : 'failed';

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]" data-reply-check={tone}>
      <div className="flex flex-wrap items-start gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
        <MailCheck className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--indigo)]" />
        <div className="min-w-[14rem] flex-1">
          <p className="text-strong font-semibold text-[var(--text-primary)]">Does a reply stop the sequence?</p>
          <p className="text-caption text-[var(--text-tertiary)]">
            One of your mailboxes emails another, which answers. Inbox sync has to find the answer, match it and stop the sequence - the same path a prospect's reply takes.
          </p>
        </div>
        <Button size="sm" variant="secondary" className="ml-auto" onClick={() => run.mutate()} disabled={running}>
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
          {running ? `Checking… ${elapsed}s` : 'Check now'}
        </Button>
      </div>

      <ol className="grid grid-cols-1 gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-5">
        {REPLY_CHECK_STAGES.map((s) => {
          const done = reached.has(s);
          const failed = !running && r?.failed_at === s;
          const Icon = done ? CheckCircle2 : failed ? XCircle : running && !done ? Loader2 : Circle;
          return (
            <li key={s} className="flex items-center gap-2 sm:flex-col sm:items-start sm:gap-1" data-reply-stage={s} data-reply-stage-state={done ? 'done' : failed ? 'failed' : 'pending'}>
              <Icon className={cn('h-4 w-4 flex-shrink-0',
                done ? 'text-emerald-500' : failed ? 'text-rose-500' : 'text-[var(--text-muted)]',
                running && !done && 'animate-spin')} />
              <span className={cn('text-caption', done || failed ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]')}>
                {REPLY_CHECK_STAGE_LABELS[s]}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="border-t border-[var(--border-subtle)] px-4 py-3 space-y-2">
        {running ? (
          <p className="text-body text-[var(--text-secondary)]">Waiting for the answer to come back through the inbox. This usually takes under a minute, and gives up after two.</p>
        ) : r ? (
          <>
            <p className={cn('text-body', tone === 'ok' ? 'text-emerald-700 dark:text-emerald-400' : tone === 'failed' ? 'text-rose-700 dark:text-rose-400' : 'text-[var(--text-secondary)]')}>
              {r.detail}
            </p>
            <p className="text-caption text-[var(--text-tertiary)]">
              Checked {formatRelativeTime(r.ran_at)}
              {r.from_mailbox && ` · ${r.to_mailbox && r.to_mailbox !== r.from_mailbox ? `${r.to_mailbox} answering ${r.from_mailbox}` : r.from_mailbox}`}
              {!r.ok && status.last_ok_at && ` · last passed ${formatRelativeTime(status.last_ok_at)}`}
            </p>
          </>
        ) : (
          <p className="text-body text-[var(--text-tertiary)]">Not checked yet. It takes about a minute and leaves two short emails in your mailboxes.</p>
        )}
        <label className="flex items-center gap-2.5 pt-1 text-caption text-[var(--text-secondary)]">
          <Toggle
            size="sm"
            checked={status.daily}
            disabled={!status.persisted || daily.isPending}
            onChange={(v) => daily.mutate(v)}
            aria-label="Check once a day"
          />
          <span>
            Check once a day on its own and tell me if it fails
            {!status.persisted && ' (needs migration 079)'}
          </span>
        </label>
      </div>
    </div>
  );
}

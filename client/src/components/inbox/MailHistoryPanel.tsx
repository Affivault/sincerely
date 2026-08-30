import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { inboxApi } from '../../api/inbox.api';
import { smtpApi } from '../../api/smtp.api';
import { SYNC_WINDOW_MONTHS, syncWindowLabel } from '@lemlist/shared';
import type { InboxSyncProgress, SyncWindowMonths } from '@lemlist/shared';
import { cn, formatRelativeTime } from '../../lib/utils';
import { AlertTriangle, Check, History, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

/* ═══════════════════════════════════════════════════════════════════════
   How far back a connected mailbox reaches.

   Connecting one used to bring seven days of inbox and nothing else, with
   no setting anywhere — so the inbox opened nearly empty and there was no
   way to ask for more. This is that setting, and, just as importantly, an
   honest account of what has actually arrived so far: choosing six months
   does not mean six months are there yet, and a progress bar that pretends
   otherwise is worse than none.
   ═══════════════════════════════════════════════════════════════════════ */

function sinceLabel(iso: string | null): string {
  if (!iso) return 'nothing yet';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'nothing yet';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function MailboxRow({
  account,
  onChoose,
  saving,
}: {
  account: InboxSyncProgress;
  onChoose: (months: SyncWindowMonths) => void;
  saving: boolean;
}) {
  return (
    <li className="px-4 py-3 border-b border-[var(--border-subtle)] last:border-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--text-primary)]">
          {account.email_address}
        </span>

        <div className="flex items-center gap-1">
          {SYNC_WINDOW_MONTHS.map((months) => {
            const active = account.window_months === months;
            return (
              <button
                key={months}
                type="button"
                disabled={saving}
                onClick={() => !active && onChoose(months)}
                className={cn(
                  'h-7 rounded-md px-2.5 text-[11.5px] font-semibold transition-colors disabled:opacity-50',
                  active
                    ? 'bg-[var(--indigo)] text-white'
                    : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                )}
                title={`Keep ${syncWindowLabel(months).toLowerCase()} of this mailbox`}
              >
                {months}m
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
        <span>
          {account.stored.toLocaleString()} message{account.stored === 1 ? '' : 's'}
        </span>
        <span>back to <span className="font-semibold text-[var(--text-secondary)]">{sinceLabel(account.oldest_synced_at)}</span></span>
        {account.last_synced_at && !account.last_error && (
          <span title={new Date(account.last_synced_at).toLocaleString()}>
            synced {formatRelativeTime(account.last_synced_at)}
          </span>
        )}
        {account.history_complete ? (
          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <Check className="h-3 w-3" strokeWidth={3} /> history loaded
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[var(--indigo)]">
            <Loader2 className="h-3 w-3 animate-spin" /> still fetching older mail
          </span>
        )}
      </div>

      {account.last_error && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-px h-3 w-3 flex-shrink-0" />
          {account.last_error}
        </p>
      )}
    </li>
  );
}

export function MailHistoryPanel({ onSynced }: { onSynced?: () => void }) {
  const qc = useQueryClient();

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['inbox-sync-progress'],
    queryFn: inboxApi.syncProgress,
    // While a backfill is running the numbers change under the user, and a
    // panel that has to be reloaded to show that is a panel nobody trusts.
    // Once history is complete, a slower poll still keeps "synced Xm ago"
    // honest — the background scheduler syncs every 5 minutes on its own,
    // and a number that only updates on page reload would look stalled.
    refetchInterval: (query) => {
      const rows = query.state.data as InboxSyncProgress[] | undefined;
      return rows?.some((a) => !a.history_complete) ? 5000 : 60000;
    },
    meta: { silentError: true },
  });

  const setWindow = useMutation({
    mutationFn: ({ id, months }: { id: string; months: SyncWindowMonths }) =>
      smtpApi.update(id, { inbox_sync_months: months } as any),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['inbox-sync-progress'] });
      qc.invalidateQueries({ queryKey: ['smtp-accounts'] });
      toast.success(
        `Keeping ${syncWindowLabel(variables.months).toLowerCase()}. Older mail arrives in the background.`,
      );
      // Start straight away rather than waiting for the next poll — the whole
      // point of pressing it is to see the older mail.
      sync.mutate();
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Could not change the history window'),
  });

  const sync = useMutation({
    mutationFn: inboxApi.syncInbox,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['inbox-sync-progress'] });
      onSynced?.();
      if (result.backfilled > 0) {
        toast.success(`${result.backfilled} older message${result.backfilled === 1 ? '' : 's'} loaded`);
      }
      // More history left: keep going rather than making the user press again
      // for every fortnight of mail.
      if (result.more) sync.mutate();
    },
    meta: { silentError: true },
  });

  if (isLoading) return <div className="h-24 rounded-xl bg-[var(--bg-elevated)] animate-pulse" />;
  if (!accounts || accounts.length === 0) return null;

  const loading = accounts.some((a) => !a.history_complete);

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-start gap-2.5 border-b border-[var(--border-subtle)] p-4">
        <span className="mt-px flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--indigo-subtle)]">
          <History className="h-3.5 w-3.5 text-[var(--indigo)]" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Mail history</h3>
          <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--text-secondary)]">
            How far back each mailbox is kept. Older mail is fetched in the background, a little at
            a time, so a wide window never holds up today&rsquo;s replies.
          </p>
        </div>
        {loading && (
          <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-[var(--indigo-subtle)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--indigo)]">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading
          </span>
        )}
      </div>

      <ul>
        {accounts.map((account) => (
          <MailboxRow
            key={account.smtp_account_id}
            account={account}
            saving={setWindow.isPending}
            onChoose={(months) => setWindow.mutate({ id: account.smtp_account_id, months })}
          />
        ))}
      </ul>
    </div>
  );
}

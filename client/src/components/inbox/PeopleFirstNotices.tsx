import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Newspaper, ShieldAlert, UserCheck, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { MAIL_KIND_LABELS, type MailKind } from '@lemlist/shared';
import { inboxApi } from '../../api/inbox.api';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   The strips above the Unibox list that go with the people-first inbox:

   - while older mail is being sorted, say so (counts are still settling)
   - inside Other mail, filter by kind and say what the folder is
   - when Relay unsubscribed someone on a reading it no longer holds, offer
     them back - one click each, never automatic
   ═══════════════════════════════════════════════════════════════════════ */

type OtherKind = Exclude<MailKind, 'person'>;

export function InboxNotices({
  folder, sorting, mailKindFilter, onMailKind,
}: {
  folder: string;
  sorting: boolean;
  mailKindFilter: 'all' | OtherKind;
  onMailKind: (k: 'all' | OtherKind) => void;
}) {
  return (
    <>
      {sorting && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--indigo-subtle)] text-body text-[var(--text-secondary)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--indigo)]" />
          Sorting your mail into people and everything else. Counts will settle in a minute.
        </div>
      )}
      <RelayReviewBanner />
      {folder === 'other' && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          <Newspaper className="h-3.5 w-3.5 text-[var(--text-tertiary)] mr-0.5" />
          {(['all', ...Object.keys(MAIL_KIND_LABELS)] as Array<'all' | OtherKind>).map((k) => (
            <button
              key={k}
              onClick={() => onMailKind(k)}
              className={cn(
                'h-7 px-2.5 rounded-full text-caption font-medium border transition-colors',
                mailKindFilter === k
                  ? 'border-[rgba(91,91,245,0.4)] bg-[var(--indigo-subtle)] text-[var(--indigo)]'
                  : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
              )}
            >
              {k === 'all' ? 'All' : MAIL_KIND_LABELS[k]}
            </button>
          ))}
          <span className="ml-auto hidden md:inline text-caption text-[var(--text-tertiary)]">
            Kept out of your inbox and every count. Relay never reads it. Someone in here who is a real person? Open it and choose "This is a person".
          </span>
        </div>
      )}
    </>
  );
}

function RelayReviewBanner() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ['inbox', 'relay-status'], queryFn: inboxApi.relayStatus, staleTime: 60_000 });
  const review = data?.review || [];

  const restore = useMutation({
    mutationFn: (contactId: string) => inboxApi.relayRestore(contactId),
    onSuccess: () => { toast.success('Restored - they can be emailed again'); qc.invalidateQueries({ queryKey: ['inbox', 'relay-status'] }); qc.invalidateQueries({ queryKey: ['contacts'] }); },
    onError: () => toast.error('Could not restore them'),
  });
  const dismiss = useMutation({
    mutationFn: (contactId: string) => inboxApi.relayDismiss(contactId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbox', 'relay-status'] }),
  });

  if (!review.length) return null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--amber-subtle,rgba(245,158,11,0.08))]">
        <ShieldAlert className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
        <span className="text-body text-[var(--text-primary)]">
          Relay unsubscribed {review.length === 1 ? '1 person' : `${review.length} people`} on a reading it no longer agrees with.
        </span>
        <button onClick={() => setOpen(true)} className="text-body font-semibold text-[var(--indigo)] hover:underline">Review</button>
      </div>
      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Relay may have unsubscribed these people by mistake"
        description="Relay used to read the whole email, including the unsubscribe link in your own quoted campaign. It now reads only what they wrote, and these no longer read as a request to stop. Restore anyone you want to keep emailing."
        size="lg"
      >
        <div className="divide-y divide-[var(--border-subtle)] -mx-1">
          {review.map((r) => (
            <div key={r.contact_id} className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4 px-1 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-body font-semibold text-[var(--text-primary)] truncate">
                  {r.name || r.email}{r.company ? <span className="font-normal text-[var(--text-tertiary)]"> · {r.company}</span> : null}
                </p>
                <p className="text-caption text-[var(--text-tertiary)] truncate">{r.email}</p>
                {r.excerpt && <p className="mt-1 text-body text-[var(--text-secondary)] line-clamp-2">"{r.excerpt}"</p>}
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <Button size="sm" variant="secondary" onClick={() => dismiss.mutate(r.contact_id)} disabled={dismiss.isPending}>Keep unsubscribed</Button>
                <Button size="sm" onClick={() => restore.mutate(r.contact_id)} disabled={restore.isPending}>
                  <UserCheck className="h-3.5 w-3.5" /> Restore
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}

/**
 * Inside a conversation: mail says what it is and offers the way back;
 * a person offers the way out. Everything from the sender moves together.
 */
export function MailKindBar({ messageId, kind }: { messageId: string; kind: MailKind | null | undefined }) {
  const qc = useQueryClient();
  const move = useMutation({
    mutationFn: (to: MailKind) => inboxApi.setMailKind(messageId, to),
    onSuccess: (res) => {
      toast.success(res.kind === 'person'
        ? `Moved to your inbox${res.moved > 1 ? ` (${res.moved} messages)` : ''} - Relay will read it`
        : `Moved to Other mail${res.moved > 1 ? ` (${res.moved} messages)` : ''}`);
      qc.invalidateQueries({ queryKey: ['inbox'] });
    },
    onError: () => toast.error('Could not move it'),
  });
  const mail = !!kind && kind !== 'person';

  if (!mail) {
    return (
      <button
        onClick={() => move.mutate('bulk')}
        disabled={move.isPending}
        className="text-caption text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:underline"
        title="Newsletters, notifications and receipts live in Other mail, out of your counts"
      >
        Not a person? Move to Other mail
      </button>
    );
  }
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-muted)] px-3.5 py-2.5">
      <Newspaper className="h-4 w-4 text-[var(--text-tertiary)]" />
      <span className="text-body text-[var(--text-secondary)]">
        Filed under Other mail · {MAIL_KIND_LABELS[kind as OtherKind] || 'Mail'}. It is not counted, and Relay does not read it.
      </span>
      <button
        onClick={() => move.mutate('person')}
        disabled={move.isPending}
        className="ml-auto inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-caption font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
      >
        {move.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserCheck className="h-3 w-3" />}
        This is a person
      </button>
    </div>
  );
}

/** One line in the Relay settings and composer: whether Claude is reading. */
export function RelayEngineNote() {
  const { data } = useQuery({ queryKey: ['inbox', 'relay-status'], queryFn: inboxApi.relayStatus, staleTime: 60_000 });
  if (!data) return null;
  return (
    <p className="flex items-center gap-1.5 text-caption text-[var(--text-tertiary)]">
      <Sparkles className="h-3 w-3 text-[var(--indigo)]" />
      {data.ai
        ? 'Relay reads replies and writes with Claude.'
        : 'Relay is using keyword rules. Add ANTHROPIC_API_KEY on the server for Claude to read replies and write drafts.'}
    </p>
  );
}

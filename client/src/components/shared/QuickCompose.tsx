import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { inboxApi } from '../../api/inbox.api';
import { smtpApi } from '../../api/smtp.api';
import { templateApi } from '../../api/template.api';
import { RichTextEditor, useRichTextEditorRef } from '../ui/RichTextEditor';
import { cn } from '../../lib/utils';
import { Mail, Send, X, ChevronDown, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

/* ═══════════════════════════════════════════════════════════════════════
   Write to someone from wherever you're looking at them.

   Reading a lead's history and wanting to say something is one thought,
   and it used to cost a trip to the Unibox and a search to find them
   again. This is the composer, small enough to live inside a profile: a
   sender, a subject, a body, send. Nothing else — the Unibox keeps
   scheduling, templates-with-variables and threading.
   ═══════════════════════════════════════════════════════════════════════ */

export function QuickCompose({
  to, toName, defaultSubject, onSent, className, alwaysOpen = false,
}: {
  to: string;
  toName?: string | null;
  /** Pre-fills the subject — usually "Re: <their last thread>". */
  defaultSubject?: string | null;
  onSent?: () => void;
  className?: string;
  /** Render the form directly, for places that already chose "write email". */
  alwaysOpen?: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(alwaysOpen);
  const [subject, setSubject] = useState('');
  const [senderId, setSenderId] = useState('');
  const body = useRichTextEditorRef();

  const { data: accounts = [] } = useQuery({
    queryKey: ['smtp-accounts'],
    queryFn: smtpApi.list,
    enabled: open,
  });
  const { data: templates = [] } = useQuery({
    queryKey: ['templates', 'emails'],
    queryFn: templateApi.listEmails,
    enabled: open,
  });

  // A paused mailbox can't deliver, so offering it is offering a send that
  // will fail.
  const senders = useMemo(() => accounts.filter((a) => a.is_active), [accounts]);
  const sender = senders.find((a: any) => a.id === senderId) || senders[0];

  const start = () => {
    setSubject(defaultSubject ? (/^re:/i.test(defaultSubject) ? defaultSubject : `Re: ${defaultSubject}`) : '');
    body.reset();
    setOpen(true);
  };

  const cancel = () => {
    // When the composer IS the panel, there's nothing to collapse back to —
    // clearing it is the whole of "discard".
    if (!alwaysOpen) setOpen(false);
    body.reset();
    setSubject('');
  };

  const send = useMutation({
    mutationFn: () => inboxApi.compose({
      to,
      subject: subject.trim(),
      body: body.text,
      body_html: body.html,
      smtp_account_id: sender?.id,
    }),
    onSuccess: () => {
      // The message belongs to the inbox and to this lead's history, and
      // both are on screen somewhere the moment it lands.
      qc.invalidateQueries({ queryKey: ['inbox'] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
      toast.success(`Sent to ${toName || to}`);
      cancel();
      onSent?.();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not send that email'),
  });

  if (!open && !alwaysOpen) {
    return (
      <button
        onClick={start}
        className={cn(
          'w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-dashed border-[var(--border-default)] text-left',
          'hover:border-[var(--indigo)]/50 hover:bg-[var(--bg-hover)] transition-colors',
          className,
        )}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--bg-elevated)] flex-shrink-0">
          <Mail className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        </span>
        <span className="text-[12.5px] text-[var(--text-tertiary)]">
          Write to <span className="text-[var(--text-secondary)] font-medium">{toName || to}</span>…
        </span>
      </button>
    );
  }

  const canSend = !!sender && !!subject.trim() && !body.isEmpty && !send.isPending;

  return (
    <div className={cn('rounded-xl border border-[var(--indigo)]/40 bg-[var(--bg-surface)] overflow-hidden', className)}>
      <div className="flex items-center gap-2 px-3 h-9 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50">
        <Mail className="h-3.5 w-3.5 text-[var(--indigo)] flex-shrink-0" />
        <span className="text-[11.5px] font-semibold text-[var(--text-primary)]">
          To {toName || to}
        </span>
        <button onClick={cancel} className="ml-auto icon-btn h-6 w-6" title={alwaysOpen ? 'Clear' : 'Discard'}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="px-3 py-2 space-y-2">
        {senders.length > 1 && (
          <label className="flex items-center gap-2">
            <span className="text-[10.5px] font-medium text-[var(--text-tertiary)] w-10 flex-shrink-0">From</span>
            <span className="relative flex-1 min-w-0">
              <select
                value={sender?.id || ''}
                onChange={(e) => setSenderId(e.target.value)}
                className="w-full h-7 appearance-none rounded-lg border border-[var(--border-default)] bg-[var(--bg-app)] pl-2 pr-6 text-[11.5px] text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
              >
                {senders.map((a) => (
                  <option key={a.id} value={a.id}>{a.email_address}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--text-muted)]" />
            </span>
          </label>
        )}

        <label className="flex items-center gap-2">
          <span className="text-[10.5px] font-medium text-[var(--text-tertiary)] w-10 flex-shrink-0">Subject</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            autoFocus
            placeholder="What's this about?"
            className="flex-1 min-w-0 h-7 rounded-lg border border-[var(--border-default)] bg-[var(--bg-app)] px-2 text-[11.5px] text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
          />
        </label>
      </div>

      <div className="px-3 pb-2">
        <RichTextEditor
          placeholder={`Write to ${toName || to}…`}
          onChange={body.handleChange}
          templates={templates as any}
          minHeight="120px"
        />
      </div>

      <div className="flex items-center gap-2 px-3 py-2 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50">
        {!sender && (
          <span className="text-[11px] text-[var(--warning,#B45309)]">
            Connect a mailbox before sending.
          </span>
        )}
        <button
          onClick={() => canSend && send.mutate()}
          disabled={!canSend}
          className="ml-auto inline-flex items-center gap-1.5 h-7 px-3 rounded-lg bg-[var(--indigo)] text-[11.5px] font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {send.isPending
            ? <><Loader2 className="h-3 w-3 animate-spin" /> Sending…</>
            : <><Send className="h-3 w-3" /> Send</>}
        </button>
      </div>
    </div>
  );
}

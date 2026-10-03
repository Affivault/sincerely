import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2, Send, UserPlus } from 'lucide-react';
import { findReferrals, type Referral } from '@lemlist/shared';
import { inboxApi } from '../../api/inbox.api';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Checkbox } from '../ui/Checkbox';

/* ═══════════════════════════════════════════════════════════════════════
   "Talk to Sam - sam@acme.com."

   When a reply hands you on to somebody, say so above the conversation
   and make reaching them one step: who, the intro (Claude's when it is
   on), and whether the campaign carries on with them after it.
   ═══════════════════════════════════════════════════════════════════════ */

interface ReplyLike {
  id: string;
  direction?: string;
  from_email: string;
  sender_name?: string | null;
  body_text: string | null;
  campaign_id: string | null;
  smtp_account_id?: string | null;
}

export function ReferralCard({ msg, ownAddresses, campaignName }: {
  msg: ReplyLike;
  ownAddresses: string[];
  campaignName?: string | null;
}) {
  const found = useMemo(() => (
    msg.direction === 'outbound' || !msg.body_text ? [] : findReferrals({ body: msg.body_text, senderEmail: msg.from_email, ownAddresses })
  ), [msg.id, msg.body_text, msg.from_email, msg.direction, ownAddresses.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState<Referral | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  if (found.length === 0) return null;
  const from = (msg.sender_name || msg.from_email).split(/\s+/)[0];

  return (
    <div className="mb-5 space-y-2" data-referral>
      {found.map((r) => {
        const who = [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email;
        const contactId = done[r.email];
        return (
          <div key={r.email} className="flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/8 px-4 py-3">
            <UserPlus className="h-4 w-4 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div className="min-w-[12rem] flex-1">
              <p className="text-body font-medium text-[var(--text-primary)]">
                {from} pointed you to {who}
                {who !== r.email ? (
                  <span className="block font-normal text-[var(--text-tertiary)] sm:inline"><span className="hidden sm:inline"> · </span>{r.email}</span>
                ) : null}
              </p>
              <p className="truncate text-caption text-[var(--text-tertiary)]">"{r.context}"</p>
            </div>
            {contactId ? (
              <Link to={`/contacts/${contactId}`} className="text-caption font-semibold text-emerald-700 hover:underline dark:text-emerald-400">Emailed - open contact</Link>
            ) : (
              <Button size="sm" onClick={() => setOpen(r)}>
                <Send className="h-3.5 w-3.5" /> Reach out to {r.first_name || 'them'}
              </Button>
            )}
          </div>
        );
      })}
      {open && (
        <ReferralDialog
          msg={msg}
          person={open}
          referrer={from}
          campaignName={campaignName || null}
          onClose={() => setOpen(null)}
          onSent={(contactId) => { setDone((d) => ({ ...d, [open.email]: contactId })); setOpen(null); }}
        />
      )}
    </div>
  );
}

function ReferralDialog({ msg, person, referrer, campaignName, onClose, onSent }: {
  msg: ReplyLike;
  person: Referral;
  referrer: string;
  campaignName: string | null;
  onClose: () => void;
  onSent: (contactId: string) => void;
}) {
  const qc = useQueryClient();
  const [first, setFirst] = useState(person.first_name || '');
  const [last, setLast] = useState(person.last_name || '');
  const [email, setEmail] = useState(person.email);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [followUp, setFollowUp] = useState(!!msg.campaign_id);

  const draft = useMutation({
    mutationFn: () => inboxApi.referralDraft(msg.id, { email, first_name: first || null }),
    onSuccess: (d) => { setSubject((s) => s || d.subject); setBody((b) => b || d.body); },
    onError: () => toast.error('The draft could not be written. Write your own below.'),
  });
  // Draft once, as the dialog opens.
  useEffect(() => { draft.mutate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useMutation({
    mutationFn: () => inboxApi.referralSend(msg.id, {
      email, first_name: first || null, last_name: last || null, subject, body,
      smtp_account_id: msg.smtp_account_id || null, follow_up: followUp && !!msg.campaign_id,
    }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      toast.success(r.enrolled
        ? `Sent. ${first || email} carries on with "${r.campaign_name}" from its second email${r.campaign_running ? '' : ' once the campaign is running'}.`
        : `Sent to ${first || email}.`);
      onSent(r.contact_id);
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'It could not be sent. Try again in a moment.'),
  });

  const ready = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()) && subject.trim() && body.trim();

  return (
    <Modal
      isOpen
      onClose={() => { if (!send.isPending) onClose(); }}
      title={`Reach out to ${first || person.email}`}
      description={`${referrer} suggested them. They are added as a contact at the same company.`}
      size="lg"
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={send.isPending}>Cancel</Button>
          <Button onClick={() => send.mutate()} disabled={!ready || send.isPending || draft.isPending}>
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send
          </Button>
        </div>
      }
    >
      <div className="space-y-3" data-referral-dialog>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input label="First name" value={first} onChange={(e) => setFirst(e.target.value)} />
          <Input label="Last name" value={last} onChange={(e) => setLast(e.target.value)} />
          <Input label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={draft.isPending ? 'Writing…' : ''} />
        <div>
          <label htmlFor="referral-body" className="mb-1 block text-body font-medium text-[var(--text-secondary)]">Message</label>
          <textarea
            id="referral-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={9}
            placeholder={draft.isPending ? 'Writing the introduction…' : ''}
            className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2 text-body text-[var(--text-primary)] outline-none focus:border-[var(--indigo)] focus:ring-2 focus:ring-[var(--indigo)]/15"
          />
          {draft.data && (
            <p className="mt-1 text-caption text-[var(--text-tertiary)]">
              {draft.data.engine === 'ai' ? 'Written by Claude from the conversation.' : 'A plain introduction - edit it to taste.'} Sent from the mailbox their reply came in on.
            </p>
          )}
        </div>
        {msg.campaign_id && (
          <label className="flex items-start gap-2.5 rounded-xl border border-[var(--border-subtle)] px-3 py-2.5 text-body text-[var(--text-secondary)]">
            <Checkbox className="mt-0.5" checked={followUp} onChange={setFollowUp} aria-label="Follow up with the rest of the campaign" />
            <span>
              Then follow up with the rest of {campaignName ? <strong className="text-[var(--text-primary)]">"{campaignName}"</strong> : 'the campaign'}
              <span className="block text-caption text-[var(--text-tertiary)]">This email counts as its first; the follow-ups go out on the campaign's own schedule and stop when they reply.</span>
            </span>
          </label>
        )}
      </div>
    </Modal>
  );
}

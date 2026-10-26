import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { MailX, Send } from 'lucide-react';
import {
  DEFAULT_NO_SHOW_BODY, DEFAULT_NO_SHOW_SUBJECT, NO_SHOW_TAGS, unknownNoShowTags,
  formatDate, type NoShowOutcome,
} from '@lemlist/shared';
import { crmApi } from '../../api/crm.api';
import { settingsApi } from '../../api/settings.api';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Toggle } from '../ui/Toggle';
import { Notice } from '../ui/Notice';
import { AsyncPanel } from '../ui/AsyncPanel';

/* ═══════════════════════════════════════════════════════════════════════
   No-shows: the rebook email, offered or sent, and the setting behind it.

   Marking a meeting as a no-show is where the follow-up is offered: the
   moment somebody has noticed is the moment it is worth sending. The
   email itself is built and sent by the server (services/no-show) through
   the booking mail path, from the account's own mailbox.
   ═══════════════════════════════════════════════════════════════════════ */

const EVENT_KEYS = [['crm'], ['contact-crm'], ['contact-timeline'], ['contact-engagement']];

/** What to tell somebody after a meeting has been marked as a no-show. */
export function sayNoShowOutcome(o: NoShowOutcome | null | undefined) {
  if (!o) return;
  if (o.followup === 'sent') toast.success('Marked as a no-show, and the rebook email has gone.');
  else if (o.followup === 'already') toast.success('Marked as a no-show. A follow-up was already sent.');
  else if (o.followup === 'unavailable') toast(`Marked as a no-show. No follow-up: ${o.reason || 'it cannot be sent'}`);
  else toast.success('Marked as a no-show.');
}

/** The follow-up, previewed with the account's wording, editable, then sent. */
export function NoShowFollowUpDialog({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const preview = useQuery({
    queryKey: ['no-show-preview', eventId],
    queryFn: () => crmApi.noShowPreview(eventId),
    retry: false,
  });
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  useEffect(() => {
    if (preview.data) { setSubject(preview.data.subject); setBody(preview.data.body); }
  }, [preview.data]);

  const send = useMutation({
    mutationFn: () => crmApi.sendNoShowFollowUp(eventId, { subject, body }),
    onSuccess: (r) => {
      for (const key of EVENT_KEYS) qc.invalidateQueries({ queryKey: key });
      toast.success(`Sent to ${r.to}`);
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not send it'),
  });

  const sentAt = preview.data?.already_sent_at;
  return (
    <Modal
      isOpen
      onClose={onClose}
      size="lg"
      title="Sorry we missed you"
      description="Most no-shows are a clash, not a no. Offer a new time while it is still fresh."
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Not now</Button>
          <Button
            onClick={() => send.mutate()}
            disabled={send.isPending || !preview.data}
            blockedBy={sentAt ? 'Already sent for this meeting' : !subject.trim() || !body.trim() ? 'Write a subject and a message' : null}
          >
            <Send className="h-3.5 w-3.5" /> {send.isPending ? 'Sending...' : 'Send it'}
          </Button>
        </div>
      }
    >
      <AsyncPanel query={preview} skeleton="text" skeletonRows={6}>
        {(p) => (
          <div className="space-y-3">
            {sentAt && <Notice tone="info">A follow-up was already sent on {formatDate(sentAt)}.</Notice>}
            <p className="text-caption text-[var(--text-secondary)]">
              To <strong className="text-[var(--text-primary)]">{p.to}</strong>, from your own mailbox.
              {p.booking_link ? ' Your booking page goes underneath as a button.' : ''}
            </p>
            <Input label="Subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
            <label className="block">
              <span className="mb-1 block text-body font-medium text-[var(--text-secondary)]">Message</span>
              <textarea
                value={body}
                maxLength={5000}
                rows={9}
                onChange={(e) => setBody(e.target.value)}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-body text-[var(--text-primary)] focus:border-[var(--indigo)] focus:outline-none"
              />
            </label>
          </div>
        )}
      </AsyncPanel>
    </Modal>
  );
}

/**
 * The account's no-show setting and wording. Lives with the booking pages,
 * because that is where every other "what happens after a booking" lives.
 */
export function NoShowSettingsCard() {
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  useEffect(() => {
    if (!settings) return;
    setSubject(settings.no_show_subject || DEFAULT_NO_SHOW_SUBJECT);
    setBody(settings.no_show_body || DEFAULT_NO_SHOW_BODY);
  }, [settings]);

  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => settingsApi.update(patch as any),
    onSuccess: (saved: any, patch) => {
      qc.setQueryData(['settings'], saved);
      // Saving to a database without 096 strips the unknown column and
      // returns the old value: say so instead of reporting a save.
      const landed = Object.keys(patch).every((k) => (saved?.[k] ?? '') === (patch[k] ?? ''));
      if (!landed) {
        toast.error('Not saved: no-show settings need database migration 096.');
        return;
      }
      toast.success('Saved');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save that'),
  });

  const unknown = unknownNoShowTags(`${subject}\n${body}`);
  const dirty = !!settings
    && (subject !== (settings.no_show_subject || DEFAULT_NO_SHOW_SUBJECT) || body !== (settings.no_show_body || DEFAULT_NO_SHOW_BODY));

  return (
    <section className="panel space-y-3.5 p-5" data-no-show-settings>
      <div className="flex items-start gap-3">
        <MailX className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--text-tertiary)]" />
        <div className="min-w-0 flex-1">
          <h2 className="text-strong font-semibold text-[var(--text-primary)]">When somebody does not turn up</h2>
          <p className="mt-0.5 text-caption text-[var(--text-secondary)]">
            Marking a booked meeting as a no-show offers this email, with your booking page to pick a new time.
          </p>
        </div>
        <Toggle
          checked={!!settings?.no_show_auto_send}
          onChange={(on) => save.mutate({ no_show_auto_send: on })}
          disabled={!settings || save.isPending}
          aria-label="Send it automatically"
        />
      </div>
      <p className="text-caption text-[var(--text-tertiary)]">
        {settings?.no_show_auto_send
          ? 'On: it is sent by itself as soon as a meeting booked through a link is marked as a no-show.'
          : 'Off: you are offered the email to read and send. Switch on to send it automatically.'}
      </p>
      <Input label="Subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
      <label className="block">
        <span className="mb-1 block text-body font-medium text-[var(--text-secondary)]">Message</span>
        <textarea
          value={body}
          maxLength={5000}
          rows={9}
          onChange={(e) => setBody(e.target.value)}
          className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-body text-[var(--text-primary)] focus:border-[var(--indigo)] focus:outline-none"
        />
      </label>
      <p className="text-caption text-[var(--text-tertiary)]">
        Merge tags: {NO_SHOW_TAGS.map((t) => `{{${t.tag}}}`).join(' ')} - add a fallback with a bar, like {'{{first_name|there}}'}.
      </p>
      {unknown.length > 0 && (
        <Notice tone="attention">Not a tag this email knows: {unknown.map((t) => `{{${t}}}`).join(', ')}. It would be sent as typed.</Notice>
      )}
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setSubject(DEFAULT_NO_SHOW_SUBJECT); setBody(DEFAULT_NO_SHOW_BODY); }}
        >
          Use the default wording
        </Button>
        <Button
          size="sm"
          onClick={() => save.mutate({
            // Stored empty when it matches the default, so a better default
            // later reaches everybody who never changed it.
            no_show_subject: subject === DEFAULT_NO_SHOW_SUBJECT ? '' : subject,
            no_show_body: body === DEFAULT_NO_SHOW_BODY ? '' : body,
          })}
          disabled={save.isPending}
          blockedBy={!dirty ? 'Nothing has changed' : null}
        >
          Save wording
        </Button>
      </div>
    </section>
  );
}

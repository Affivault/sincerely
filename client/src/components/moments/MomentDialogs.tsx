import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ListPlus, Loader2, Send } from 'lucide-react';
import type { Signal, SignalPerson } from '@lemlist/shared';
import { signalsApi } from '../../api/signals.api';
import { campaignsApi } from '../../api/campaigns.api';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';

/* Acting on a moment: an email that opens with it, or the person added to
   a campaign with it as their first line. Used on the Moments page and in
   the Today list on Home. */

export type MomentRef = Pick<Signal, 'id' | 'headline' | 'opener'>;

const who = (p: SignalPerson) => p.name || p.email;

export function MomentWriteDialog({ moment, to, onClose, onSent }: { moment: MomentRef; to: SignalPerson; onClose: () => void; onSent: () => void }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const draft = useMutation({
    mutationFn: () => signalsApi.draft(moment.id, to.id),
    onSuccess: (d) => { setSubject((s) => s || d.subject); setBody((b) => b || d.body); },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'The draft could not be written. Write your own below.'),
  });
  useEffect(() => { draft.mutate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const send = useMutation({
    mutationFn: () => signalsApi.send(moment.id, { contact_id: to.id, subject, body }),
    onSuccess: () => { toast.success(`Sent to ${who(to)}.`); onSent(); },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'It could not be sent. Try again in a moment.'),
  });
  return (
    <Modal
      isOpen
      onClose={() => { if (!send.isPending) onClose(); }}
      title={`Write to ${who(to)}`}
      description={moment.headline}
      size="lg"
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={send.isPending}>Cancel</Button>
          <Button onClick={() => send.mutate()} disabled={!subject.trim() || !body.trim() || send.isPending || draft.isPending}>
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
          </Button>
        </div>
      }
    >
      <div className="space-y-3" data-moment-write>
        <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={draft.isPending ? 'Writing…' : ''} />
        <div>
          <label htmlFor="moment-body" className="mb-1 block text-body font-medium text-[var(--text-secondary)]">Message</label>
          <textarea
            id="moment-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            placeholder={draft.isPending ? 'Writing an email that opens with this…' : ''}
            className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2 text-body text-[var(--text-primary)] outline-none focus:border-[var(--indigo)] focus:ring-2 focus:ring-[var(--indigo)]/15"
          />
          {draft.data && (
            <p className="mt-1 text-caption text-[var(--text-tertiary)]">
              {draft.data.engine === 'ai' ? 'Written by Relay from the moment and what you sell.' : 'A plain draft. Edit it to taste.'} It never mentions how you found out.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function MomentAddDialog({ moment, to, onClose, onAdded }: { moment: MomentRef; to: SignalPerson; onClose: () => void; onAdded: () => void }) {
  const { data } = useQuery({ queryKey: ['campaigns', 'pick'], queryFn: () => campaignsApi.list({ limit: 100 }), staleTime: 60_000 });
  const campaigns = (data?.data || []).filter((c: any) => c.status !== 'completed' && c.status !== 'archived');
  const [campaignId, setCampaignId] = useState('');
  const add = useMutation({
    mutationFn: () => signalsApi.enrol(moment.id, { contact_id: to.id, campaign_id: campaignId }),
    onSuccess: (r) => {
      if (r.already_in) { toast.success(`${who(to)} is already in "${r.campaign_name}". Marked as done.`); onAdded(); }
      else if (r.added > 0) { toast.success(`${who(to)} added to "${r.campaign_name}".`); onAdded(); }
      else toast.error(`${who(to)} was not added: they may already be in it, or cannot be emailed.`);
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'They could not be added.'),
  });
  return (
    <Modal
      isOpen
      onClose={() => { if (!add.isPending) onClose(); }}
      title={`Add ${who(to)} to a campaign`}
      description={moment.headline}
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={add.isPending}>Cancel</Button>
          <Button onClick={() => add.mutate()} disabled={!campaignId || add.isPending}>
            {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListPlus className="h-4 w-4" />} Add
          </Button>
        </div>
      }
    >
      <div className="space-y-3" data-moment-add>
        <Select
          label="Campaign"
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
          placeholder={campaigns.length ? 'Choose a campaign' : 'No campaigns yet'}
          options={campaigns.map((c: any) => ({ value: c.id, label: c.name }))}
        />
        {moment.opener ? (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2.5">
            <p className="text-caption font-medium text-[var(--text-secondary)]">Their first line becomes</p>
            <p className="mt-0.5 text-body text-[var(--text-primary)]">{moment.opener}</p>
            <p className="mt-1 text-caption text-[var(--text-tertiary)]">Used wherever the campaign has {'{{first_line}}'}.</p>
          </div>
        ) : (
          <p className="text-caption text-[var(--text-tertiary)]">They start from the campaign's first email, on its own schedule.</p>
        )}
      </div>
    </Modal>
  );
}

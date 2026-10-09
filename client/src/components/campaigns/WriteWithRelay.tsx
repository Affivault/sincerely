import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Sparkles, Loader2, Wand2, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { plural } from '@lemlist/shared';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { campaignsApi, type WrittenSequence } from '../../api/campaigns.api';
import { settingsApi } from '../../api/settings.api';
import { inboxApi } from '../../api/inbox.api';
import { cn } from '../../lib/utils';
import { Chip } from '../ui/Chip';

/* ═══════════════════════════════════════════════════════════════════════
   Write with Relay.

   The blank sequence editor is where first campaigns stall. Pick the list,
   say what you sell (remembered after the first time), and Relay drafts
   the emails - with a personal first line per lead when Claude is on.
   What comes back lands in the builder as an ordinary, editable draft.
   ═══════════════════════════════════════════════════════════════════════ */

type Tone = 'friendly' | 'direct' | 'formal';

export function WriteWithRelay({
  isOpen, onClose, lists, defaultListId, hasSteps, onWritten,
}: {
  isOpen: boolean;
  onClose: () => void;
  lists: Array<{ id: string; name: string; contact_count?: number }>;
  defaultListId?: string | null;
  hasSteps: boolean;
  /** listId: add that list's leads to the campaign too. */
  onWritten: (seq: WrittenSequence, listId: string | null) => void;
}) {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get, enabled: isOpen });
  const { data: relay } = useQuery({ queryKey: ['inbox', 'relay-status'], queryFn: inboxApi.relayStatus, enabled: isOpen, staleTime: 60_000 });

  const [listId, setListId] = useState<string>('');
  const [offer, setOffer] = useState('');
  const [audience, setAudience] = useState('');
  const [goal, setGoal] = useState('');
  const [tone, setTone] = useState<Tone>('friendly');
  const [steps, setSteps] = useState(3);
  const [personalize, setPersonalize] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    setListId((cur) => cur || defaultListId || lists[0]?.id || '');
  }, [isOpen, defaultListId, lists]);
  useEffect(() => {
    if (!settings) return;
    setOffer((cur) => cur || (settings as any).relay_offer || '');
    setTone(((settings as any).relay_tone as Tone) || 'friendly');
  }, [settings]);

  const write = useMutation({
    mutationFn: () => campaignsApi.writeSequence({
      list_id: listId || null, offer, audience, goal, tone, steps, personalize,
    }),
    onSuccess: (seq) => {
      onWritten(seq, listId || null);
      const parts = [`Relay wrote ${plural(seq.steps.length, 'email')}`];
      if (seq.personalized) parts.push(`and a first line for ${plural(seq.personalized, 'lead')}`);
      toast.success(`${parts.join(' ')}. Read them through before you launch.`);
      onClose();
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Relay could not write the sequence. Try again in a moment.'),
  });

  const chosen = lists.find((l) => l.id === listId);
  const ai = !!relay?.ai;
  const ready = offer.trim().length >= 20;

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => { if (!write.isPending) onClose(); }}
      title="Write with Relay"
      description={ai
        ? 'Relay drafts the sequence from what you sell and who is on the list. You edit everything before it goes anywhere.'
        : 'Relay drafts a plain sequence from what you sell. With ANTHROPIC_API_KEY set on the server, Claude writes it and adds a first line for each lead.'}
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3 w-full">
          <span className="text-caption text-[var(--text-tertiary)]">
            {hasSteps ? 'Replaces the emails in this draft.' : 'Nothing is sent or saved until you do.'}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={write.isPending}>Cancel</Button>
            <Button onClick={() => write.mutate()} disabled={!ready || write.isPending}>
              {write.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              {write.isPending ? (personalize && ai ? 'Writing emails and first lines...' : 'Writing...') : 'Write the sequence'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Who it is for">
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              value={listId}
              onChange={(e) => setListId(e.target.value)}
              className="h-9 flex-1 min-w-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2.5 text-body text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
            >
              <option value="">No list - write for the leads I pick</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>{l.name}{typeof l.contact_count === 'number' ? ` (${l.contact_count})` : ''}</option>
              ))}
            </select>
            <input
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              maxLength={300}
              placeholder="Describe them (optional), e.g. operations leads at UK logistics firms"
              className="h-9 flex-[1.4] min-w-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 text-body text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--indigo)]"
            />
          </div>
          {chosen && (
            <p className="mt-1 flex items-center gap-1 text-caption text-[var(--text-tertiary)]">
              <Users className="h-3 w-3" /> Its leads are added to the campaign too.
            </p>
          )}
        </Field>

        <Field label="What you sell" hint="Who it is for, what it does for them, and any proof you are happy to have quoted. Saved for next time.">
          <textarea
            value={offer}
            onChange={(e) => setOffer(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="e.g. We help logistics firms cut failed deliveries with route checks before dispatch. Customers typically see 20% fewer failed drops in the first month."
            className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2 text-body text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--indigo)] focus:ring-2 focus:ring-[var(--indigo)]/15"
          />
          {!ready && offer.length > 0 && <p className="mt-1 text-caption text-[var(--text-tertiary)]">A sentence or two more helps Relay write something specific ({Math.max(0, 20 - offer.trim().length)} more characters to start).</p>}
        </Field>

        <Field label="A good outcome">
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            maxLength={200}
            placeholder="e.g. a 15-minute call with whoever runs partnerships"
            className="h-9 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 text-body text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--indigo)]"
          />
        </Field>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2">
            <span className="text-body font-medium text-[var(--text-secondary)]">Emails</span>
            {[2, 3, 4].map((n) => (
              <Chip key={n} active={steps === n} onClick={() => setSteps(n)}>{n}</Chip>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-body font-medium text-[var(--text-secondary)]">Tone</span>
            {(['friendly', 'direct', 'formal'] as const).map((t) => (
              <Chip key={t} active={tone === t} onClick={() => setTone(t)}>{t[0].toUpperCase() + t.slice(1)}</Chip>
            ))}
          </div>
        </div>

        <label className={cn('flex items-start gap-2.5 rounded-xl border px-3 py-2.5', ai ? 'border-[var(--border-subtle)] cursor-pointer' : 'border-dashed border-[var(--border-subtle)] opacity-70')}>
          <input
            type="checkbox"
            checked={personalize && ai}
            disabled={!ai}
            onChange={(e) => setPersonalize(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 accent-[var(--indigo)]"
          />
          <span>
            <span className="flex items-center gap-1.5 text-body font-semibold text-[var(--text-primary)]">
              <Sparkles className="h-3.5 w-3.5 text-[var(--indigo)]" /> A first line for each lead
            </span>
            <span className="block text-caption text-[var(--text-tertiary)] mt-0.5">
              {ai
                ? `One opening sentence per lead from what is known about them, stored as {{first_line}}${chosen?.contact_count ? ` (up to 200 of ${chosen.contact_count})` : ''}. Never invented news or numbers.`
                : 'Needs Claude (ANTHROPIC_API_KEY on the server).'}
            </span>
          </span>
        </label>
      </div>
    </Modal>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-body font-semibold text-[var(--text-primary)]">{label}</p>
      {hint && <p className="text-caption text-[var(--text-tertiary)] mb-1.5">{hint}</p>}
      <div className={hint ? '' : 'mt-1.5'}>{children}</div>
    </div>
  );
}

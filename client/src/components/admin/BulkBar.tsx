import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Ban, Gift, PauseCircle, PlayCircle, ShieldCheck, X } from 'lucide-react';
import { formatCredits, type AdminBulkAction } from '@lemlist/shared';
import { adminApi } from '../../api/admin.api';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { cn } from '../../lib/utils';
import { errMsg, inputCls } from './adminUi';

const ACTIONS: Array<{ id: AdminBulkAction; label: string; icon: typeof Ban; danger?: boolean; verb: string }> = [
  { id: 'give_credits', label: 'Give credits', icon: Gift, verb: 'Give credits to' },
  { id: 'pause_campaigns', label: 'Pause campaigns', icon: PauseCircle, verb: 'Pause every campaign of' },
  { id: 'hold_sending', label: 'Hold sending', icon: PauseCircle, verb: 'Hold all sending of' },
  { id: 'release_sending', label: 'Lift hold', icon: PlayCircle, verb: 'Lift the sending hold on' },
  { id: 'suspend', label: 'Suspend', icon: Ban, danger: true, verb: 'Suspend' },
  { id: 'unsuspend', label: 'Unsuspend', icon: ShieldCheck, verb: 'Lift the suspension of' },
];

/*
 * The selected accounts, and what can be done to all of them at once. Each
 * is done one by one on the server, so one that fails does not stop the
 * rest, and each goes in the activity log as if done by hand.
 */
export function BulkBar({ ids, emails, onDone }: { ids: string[]; emails: string[]; onDone: () => void }) {
  const qc = useQueryClient();
  const [action, setAction] = useState<AdminBulkAction | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const chosen = ACTIONS.find((a) => a.id === action);

  const mut = useMutation({
    mutationFn: () => adminApi.bulk(action!, ids, { amount: Number(amount), note, reason }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['admin'] });
      if (r.failed.length) toast.error(`${r.done} done, ${r.failed.length} failed: ${r.failed.slice(0, 3).map((f) => `${f.email || f.id.slice(0, 8)} (${f.error})`).join('; ')}`, { duration: 9000 });
      else toast.success(`Done for ${r.done} account${r.done === 1 ? '' : 's'}.`);
      setAction(null); setAmount(''); setNote(''); setReason('');
      onDone();
    },
    onError: (e) => toast.error(errMsg(e, 'That could not be done.')),
  });

  const n = Number(amount);
  const ready = action === 'give_credits' ? amount.trim() !== '' && Number.isFinite(n) && n !== 0 && note.trim() !== '' : !!action;

  return (
    <>
      <div role="toolbar" aria-label="Selected accounts" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[40] w-max max-w-[calc(100vw-32px)] overflow-x-auto rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-xl px-3 py-2 flex items-center gap-1">
        <span className="shrink-0 text-body font-medium text-[var(--text-primary)] tabular px-1 mr-1">{ids.length} selected</span>
        {ACTIONS.map((a) => (
          <Button key={a.id} size="sm" variant={a.danger ? 'danger' : 'ghost'} className="shrink-0" onClick={() => setAction(a.id)}>
            <a.icon className="h-3.5 w-3.5" /> {a.label}
          </Button>
        ))}
        <button onClick={onDone} aria-label="Clear the selection" className="shrink-0 h-7 w-7 inline-flex items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <Modal
        isOpen={!!chosen}
        onClose={() => setAction(null)}
        title={chosen ? `${chosen.verb} ${ids.length} account${ids.length === 1 ? '' : 's'}?` : ''}
        description={emails.slice(0, 6).join(', ') + (emails.length > 6 ? ` and ${emails.length - 6} more` : '')}
        size="sm"
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAction(null)}>Cancel</Button>
            <Button variant={chosen?.danger ? 'danger' : 'primary'} disabled={!ready || mut.isPending} onClick={() => mut.mutate()}>
              {mut.isPending ? 'Working…' : chosen?.label}
            </Button>
          </div>
        )}
      >
        {action === 'give_credits' && (
          <div className="space-y-2">
            <input type="number" step={0.1} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Credits each, e.g. 50 (minus takes)" aria-label="Credits each" className={inputCls} autoFocus />
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Why, for the record" aria-label="Why" className={inputCls} />
            {amount.trim() !== '' && Number.isFinite(n) && n !== 0 && (
              <p className="text-caption text-[var(--text-tertiary)]">{n > 0 ? 'Gives' : 'Takes'} {formatCredits(Math.abs(n))} credits each, {formatCredits(Math.abs(n) * ids.length)} in all.</p>
            )}
          </div>
        )}
        {action === 'suspend' && (
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Reason (only admins see it)" aria-label="Reason" className={inputCls} autoFocus />
        )}
        {action && action !== 'give_credits' && action !== 'suspend' && (
          <p className={cn('text-body text-[var(--text-secondary)]')}>Each account is done one at a time and logged; one that fails does not stop the rest.</p>
        )}
      </Modal>
    </>
  );
}

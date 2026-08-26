import { useState } from 'react';
import { LOST_REASONS, WON_REASONS } from '@lemlist/shared';
import type { Deal, DealStage } from '@lemlist/shared';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { cn } from '../../lib/utils';
import { Trophy, XCircle } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════════
   Why the deal ended.

   Closing a deal used to be a drag onto a column and nothing else, which
   means the single most informative event in a pipeline — the moment you
   find out whether the thing works — was recorded as a status change and
   no more. A quarter of losses to the same competitor looks exactly like a
   quarter of losses to bad timing.

   Asked once, at the only moment anybody knows the answer, from a short
   list. The list is the point: eleven answers of "Price" is a finding,
   eleven differently worded sentences are a pile of text nobody reads.
   Free text is still allowed, because the list will not cover everything.
   ═══════════════════════════════════════════════════════════════════════ */

export function OutcomeDialog({
  deal,
  stage,
  onCancel,
  onConfirm,
}: {
  deal: Deal;
  stage: Extract<DealStage, 'won' | 'lost'>;
  onCancel: () => void;
  onConfirm: (reason: string | null) => void;
}) {
  const won = stage === 'won';
  const options = won ? WON_REASONS : LOST_REASONS;
  const [picked, setPicked] = useState<string | null>(null);
  const [other, setOther] = useState('');

  const reason = picked === '__other' ? other.trim() || null : picked;

  return (
    <Modal
      isOpen
      onClose={onCancel}
      size="sm"
      title={won ? 'Mark as won' : 'Mark as lost'}
      description={deal.title}
      footer={
        <div className="flex justify-end gap-2">
          {/* Skipping is allowed and deliberately not hidden. A required
              field here would be answered with whatever is first in the
              list, and a pipeline full of false reasons is worse than one
              with gaps in it. */}
          <Button variant="secondary" onClick={() => onConfirm(null)}>Skip</Button>
          <Button onClick={() => onConfirm(reason)}>
            {won ? 'Mark won' : 'Mark lost'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div
          className={cn(
            'flex items-start gap-2.5 rounded-xl px-3.5 py-3',
            won
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
              : 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
          )}
        >
          {won ? <Trophy className="mt-px h-4 w-4 flex-shrink-0" /> : <XCircle className="mt-px h-4 w-4 flex-shrink-0" />}
          <p className="text-[12.5px] leading-relaxed">
            {won
              ? 'Worth recording why — the pattern across your wins is what tells you which deals to chase next.'
              : 'Worth recording why. Losses are only useful in aggregate, and only if the reasons are countable.'}
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setPicked(picked === option ? null : option)}
              className={cn(
                'rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors',
                picked === option
                  ? 'bg-[var(--indigo)] text-white'
                  : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
              )}
            >
              {option}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPicked(picked === '__other' ? null : '__other')}
            className={cn(
              'rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors',
              picked === '__other'
                ? 'bg-[var(--indigo)] text-white'
                : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
            )}
          >
            Something else
          </button>
        </div>

        {picked === '__other' && (
          <Input
            value={other}
            onChange={(e) => setOther(e.target.value)}
            placeholder="In a few words…"
            maxLength={200}
            autoFocus
          />
        )}
      </div>
    </Modal>
  );
}

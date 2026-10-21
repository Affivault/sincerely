/* ═══════════════════════════════════════════════════════════════════════
   Fix the wording of a step in a campaign that is already sending.

   A typo spotted after launch used to mean living with it or cancelling
   the campaign: every step was locked the moment it left draft. The lock
   exists for good reason - contacts part-way through the sequence are
   standing on its shape - but the words are read at the moment each email
   goes out, so changing them changes what the people who have not reached
   this step yet will receive, and nothing else. That is what this edits,
   and it says so before anything is saved.
   ═══════════════════════════════════════════════════════════════════════ */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import type { CampaignStep } from '@lemlist/shared';
import { stepHasVariantB, effectiveThreadMode, type ThreadMode } from '@lemlist/shared';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { RichTextEditor } from '../ui/RichTextEditor';
import { campaignsApi } from '../../api/campaigns.api';
import { cn } from '../../lib/utils';

export function StepWordingEditor({ campaignId, step, index, isFirstEmail = true, firstSubject, onClose }: {
  campaignId: string;
  step: CampaignStep;
  index: number;
  /** A follow-up may have a blank subject: it is then sent as a reply in the thread. */
  isFirstEmail?: boolean;
  /** The first email's subject: a follow-up repeating it is a reply. */
  firstSubject?: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const hasB = stepHasVariantB(step);
  const [variant, setVariant] = useState<'a' | 'b'>('a');
  const [subject, setSubject] = useState(step.subject || '');
  const [body, setBody] = useState({ html: step.body_html || '', text: step.body_text || '' });
  const [subjectB, setSubjectB] = useState(step.subject_b || '');
  const [bodyB, setBodyB] = useState(step.body_html_b || '');

  // A follow-up's timing and mode: read when each contact reaches the step,
  // so a change here reaches everybody who has not got that far yet.
  const isFollowUp = step.step_type === 'email' && !isFirstEmail;
  const [days, setDays] = useState(step.delay_days || 0);
  const [hours, setHours] = useState(step.delay_hours || 0);
  const [mode, setMode] = useState<ThreadMode>(effectiveThreadMode(step, firstSubject));
  const timingDirty = isFollowUp && (days !== (step.delay_days || 0) || hours !== (step.delay_hours || 0)
    || mode !== effectiveThreadMode(step, firstSubject));

  const dirty = subject !== (step.subject || '') || body.html !== (step.body_html || '')
    || (hasB && (subjectB !== (step.subject_b || '') || bodyB !== (step.body_html_b || '')))
    || timingDirty;
  const needsSubject = isFirstEmail || mode === 'new';

  const save = useMutation({
    mutationFn: () => campaignsApi.updateStep(campaignId, step.id, {
      subject,
      body_html: body.html,
      body_text: body.text,
      ...(hasB ? { subject_b: subjectB, body_html_b: bodyB } : {}),
      ...(isFollowUp ? { delay_days: days, delay_hours: hours, thread_mode: mode } : {}),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaign', campaignId] });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success(`Step ${index + 1} updated - people who have not reached it yet get the change`);
      onClose();
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Could not save the new wording'),
  });

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isFollowUp ? `Edit step ${index + 1}` : `Edit the wording of step ${index + 1}`}
      description="Only people who have not reached this step yet get the new version. What has already gone out stays as it was."
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!dirty || (needsSubject && !subject.trim()) || save.isPending}>
            {save.isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {hasB && (
          <div className="inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-0.5">
            {(['a', 'b'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVariant(v)}
                className={cn(
                  'h-7 rounded-md px-3 text-caption font-semibold transition-colors',
                  variant === v ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
                )}
              >
                Version {v.toUpperCase()}
              </button>
            ))}
          </div>
        )}
        {isFollowUp && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className="mb-1 block text-caption font-medium text-[var(--text-secondary)]">Sends after the previous step</span>
              <div className="flex items-center gap-1.5">
                <input type="number" min={0} aria-label="Days" value={days}
                  onChange={(e) => setDays(Math.max(0, parseInt(e.target.value) || 0))}
                  className="h-9 w-16 rounded-lg border border-[var(--border-default)] bg-[var(--bg-app)] px-2 text-center text-strong tabular focus:border-[var(--indigo)] focus:outline-none" />
                <span className="text-caption text-[var(--text-secondary)]">days</span>
                <input type="number" min={0} max={23} aria-label="Hours" value={hours}
                  onChange={(e) => setHours(Math.min(23, Math.max(0, parseInt(e.target.value) || 0)))}
                  className="h-9 w-16 rounded-lg border border-[var(--border-default)] bg-[var(--bg-app)] px-2 text-center text-strong tabular focus:border-[var(--indigo)] focus:outline-none" />
                <span className="text-caption text-[var(--text-secondary)]">hours</span>
              </div>
            </div>
            <div>
              <span id="live-send-as" className="mb-1 block text-caption font-medium text-[var(--text-secondary)]">Send as</span>
              <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-labelledby="live-send-as">
                {([['reply', 'Reply in thread'], ['new', 'New email']] as const).map(([value, label]) => (
                  <button key={value} type="button" role="radio" aria-checked={mode === value} onClick={() => setMode(value)}
                    className={cn('min-h-9 rounded-lg border px-2 text-caption font-semibold transition-colors',
                      mode === value
                        ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)] text-[var(--indigo-text)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]')}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {(!isFollowUp || mode === 'new') && (
        <label className="block">
          <span className="mb-1 block text-caption font-medium text-[var(--text-secondary)]">Subject</span>
          <input
            value={variant === 'a' ? subject : subjectB}
            onChange={(e) => (variant === 'a' ? setSubject(e.target.value) : setSubjectB(e.target.value))}
            className="h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-app)] px-3 text-strong text-[var(--text-primary)] focus:border-[var(--indigo)] focus:outline-none"
          />
        </label>
        )}
        {/* Keyed by variant so each version mounts its own editor state. */}
        <div key={variant}>
          <RichTextEditor
            initialContent={variant === 'a' ? body.html : bodyB}
            onChange={(html, text) => (variant === 'a' ? setBody({ html, text }) : setBodyB(html))}
            minHeight="220px"
          />
        </div>
        <p className="text-caption leading-snug text-[var(--text-tertiary)]">
          Merge tags like {'{{first_name}}'} work as before. The order of the steps and who is in the campaign stay as they are - duplicate the campaign to change those.
        </p>
      </div>
    </Modal>
  );
}

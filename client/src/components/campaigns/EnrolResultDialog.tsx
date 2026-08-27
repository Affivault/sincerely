import { useState } from 'react';
import { enrolSkipBreakdown, ENROL_SKIP_LABEL } from '@lemlist/shared';
import type { EnrolResult, EnrolSkipReason } from '@lemlist/shared';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';
import { ChevronDown, UserCheck, UserMinus } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════════
   Who actually went in, and who did not.

   "140 added, 60 skipped" was the whole story an add used to tell, and the
   60 came with a reason invented by the interface — it said "already in
   other active campaigns" no matter what had really happened, because the
   server had never sent one.

   Most skips are the product working: refusing to email someone twice,
   honouring an unsubscribe, keeping a suppressed address suppressed. That
   is a good thing to be told, and a terrible thing to have guessed at.
   ═══════════════════════════════════════════════════════════════════════ */

const REASON_TONE: Record<EnrolSkipReason, string> = {
  already_enrolled: 'text-[var(--text-tertiary)]',
  in_other_campaign: 'text-[var(--indigo)]',
  not_in_list: 'text-[var(--text-tertiary)]',
  suppressed: 'text-amber-600 dark:text-amber-400',
  unsubscribed: 'text-amber-600 dark:text-amber-400',
  bounced: 'text-red-500',
  no_email: 'text-red-500',
  not_yours: 'text-[var(--text-tertiary)]',
  /* Indigo, not amber: this is not a warning about bad data, it is the
     product stopping you from cold-pitching somebody you are currently
     negotiating with. */
  on_open_deal: 'text-[var(--indigo)]',
};

export function EnrolResultDialog({
  result,
  campaignName,
  onClose,
}: {
  result: EnrolResult;
  campaignName: string;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState<EnrolSkipReason | null>(null);
  const breakdown = enrolSkipBreakdown(result);

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="md"
      title={result.added > 0 ? 'Added, with some skipped' : 'Nothing was added'}
      description={`“${campaignName}” now has ${result.total.toLocaleString()} contact${result.total === 1 ? '' : 's'}.`}
      footer={
        <div className="flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      }
    >
      <div className="space-y-3.5">
        <div className="flex items-stretch gap-2.5">
          <div className="flex-1 rounded-xl bg-emerald-500/[0.08] px-3.5 py-3">
            <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
              <UserCheck className="h-3.5 w-3.5" />
              <span className="text-[19px] font-bold leading-none tabular-nums">
                {result.added.toLocaleString()}
              </span>
            </div>
            <p className="mt-1 text-[11px] font-medium text-[var(--text-secondary)]">
              added
            </p>
          </div>
          <div className="flex-1 rounded-xl bg-[var(--bg-elevated)] px-3.5 py-3">
            <div className="flex items-center gap-1.5 text-[var(--text-secondary)]">
              <UserMinus className="h-3.5 w-3.5" />
              <span className="text-[19px] font-bold leading-none tabular-nums">
                {result.skipped.toLocaleString()}
              </span>
            </div>
            <p className="mt-1 text-[11px] font-medium text-[var(--text-secondary)]">skipped</p>
          </div>
        </div>

        <p className="text-[11.5px] leading-relaxed text-[var(--text-tertiary)]">
          A skip is usually this working as intended — nobody gets two sequences at once, and
          suppressed and unsubscribed addresses stay that way. Open a reason to see who.
        </p>

        <ul className="overflow-hidden rounded-xl border border-[var(--border-subtle)]">
          {breakdown.map(({ reason, count }) => {
            const people = result.skips.filter((s) => s.reason === reason);
            const isOpen = expanded === reason;
            // The response carries a sample, not the world: a 10,000-row
            // import must not become a 10,000-row response.
            const hidden = count - people.length;

            return (
              <li key={reason} className="border-b border-[var(--border-subtle)] last:border-0">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : reason)}
                  className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--bg-elevated)]"
                >
                  <span className={cn('text-[13px] font-bold tabular-nums', REASON_TONE[reason])}>
                    {count.toLocaleString()}
                  </span>
                  <span className="min-w-0 flex-1 text-[12.5px] text-[var(--text-secondary)]">
                    {ENROL_SKIP_LABEL[reason]}
                  </span>
                  {people.length > 0 && (
                    <ChevronDown
                      className={cn(
                        'h-3.5 w-3.5 flex-shrink-0 text-[var(--text-tertiary)] transition-transform',
                        isOpen && 'rotate-180',
                      )}
                    />
                  )}
                </button>

                {isOpen && people.length > 0 && (
                  <ul className="max-h-52 overflow-y-auto border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 px-3.5 py-2">
                    {people.map((person) => (
                      <li
                        key={person.contact_id}
                        className="flex flex-wrap items-baseline gap-x-2 py-1 text-[11.5px]"
                      >
                        <span className="font-medium text-[var(--text-primary)]">
                          {person.name || person.email || 'Unnamed contact'}
                        </span>
                        {person.name && person.email && (
                          <span className="text-[var(--text-tertiary)]">{person.email}</span>
                        )}
                        {person.detail && (
                          <span className="text-[var(--indigo)]">{person.detail}</span>
                        )}
                      </li>
                    ))}
                    {hidden > 0 && (
                      <li className="py-1 text-[11px] italic text-[var(--text-tertiary)]">
                        and {hidden.toLocaleString()} more
                      </li>
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}

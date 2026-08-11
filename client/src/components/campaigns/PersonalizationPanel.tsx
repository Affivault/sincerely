import type { PersonalizationAudit, PersonalizationTag } from '@lemlist/shared';
import { cn } from '../../lib/utils';
import { AlertTriangle, Check, CircleSlash, Link2, User } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════════
   What the copy asks for, and how much of the audience can answer it.

   A merge tag with nothing behind it used to be invisible until a prospect
   replied to point it out — "Hi ," goes out at three in the morning and
   nobody knows until the reply lands. This shows the gaps while there is
   still time to do something about them.
   ═══════════════════════════════════════════════════════════════════════ */

/** Sorted worst-first by the service; anything above this is worth saying out loud. */
const NOTABLE_SHARE = 0.02;

export function countGaps(audit: PersonalizationAudit | undefined): number {
  if (!audit) return 0;
  return audit.tags.filter(isGap).length;
}

function isGap(tag: PersonalizationTag): boolean {
  if (tag.has_fallback || tag.missing === 0) return false;
  return tag.missing / Math.max(tag.total, 1) > NOTABLE_SHARE;
}

function toneFor(tag: PersonalizationTag): 'ok' | 'warn' | 'bad' {
  if (tag.has_fallback || tag.missing === 0) return 'ok';
  const share = tag.missing / Math.max(tag.total, 1);
  return share >= 0.5 ? 'bad' : 'warn';
}

function describe(tag: PersonalizationTag): string {
  if (tag.scope === 'link') return 'Filled in for each recipient when the email is sent.';
  if (tag.scope === 'sender') {
    return tag.missing === 0
      ? 'Taken from your profile.'
      : 'Not set on your profile — this will send blank. Add it in Settings.';
  }
  if (tag.scope === 'unknown') {
    return tag.has_fallback
      ? 'No contact field behind this — it sends the fallback text you wrote.'
      : 'No contact field behind this. It sends as nothing, leaving a gap in the sentence.';
  }
  if (tag.missing === 0) return `Every contact has this.`;
  if (tag.has_fallback) {
    return `${tag.missing.toLocaleString()} of ${tag.total.toLocaleString()} are missing it — those get your fallback text.`;
  }
  return `${tag.missing.toLocaleString()} of ${tag.total.toLocaleString()} are missing it — those emails send with a gap where it should be.`;
}

export function PersonalizationPanel({
  audit, className, emptyHint = true,
}: {
  audit: PersonalizationAudit;
  className?: string;
  /** Show the "no tags used" note. Off inside a launch prompt, where it can't happen. */
  emptyHint?: boolean;
}) {
  if (audit.tags.length === 0) {
    if (!emptyHint) return null;
    return (
      <p className={cn('text-[12px] text-[var(--text-tertiary)]', className)}>
        This sequence doesn’t use any merge tags — every recipient gets identical copy.
      </p>
    );
  }

  return (
    <ul className={cn('space-y-1.5', className)}>
      {audit.tags.map((tag) => {
        const tone = toneFor(tag);
        const share = tag.total > 0 ? tag.missing / tag.total : 0;
        const Icon = tone === 'ok' ? Check
          : tag.scope === 'sender' ? User
          : tag.scope === 'unknown' ? CircleSlash
          : AlertTriangle;

        return (
          <li
            key={tag.name}
            className="flex items-start gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 px-3 py-2"
          >
            <span className={cn(
              'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full mt-px',
              tone === 'ok' && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
              tone === 'warn' && 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
              tone === 'bad' && 'bg-[var(--error-bg)] text-[var(--error)]',
            )}>
              {tag.scope === 'link' && tone === 'ok'
                ? <Link2 className="h-3 w-3" />
                : <Icon className="h-3 w-3" strokeWidth={tone === 'ok' ? 3 : 2} />}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <code className="text-[11.5px] font-medium text-[var(--text-primary)]">
                  {`{{${tag.name}}}`}
                </code>
                <span className="text-[10.5px] text-[var(--text-tertiary)] truncate">{tag.label}</span>
              </div>
              <p className="text-[11.5px] text-[var(--text-secondary)] leading-snug mt-0.5">
                {describe(tag)}
              </p>

              {/* Only worth a bar when there is a real proportion to show. */}
              {tag.scope === 'contact' && tag.missing > 0 && (
                <div className="mt-1.5 h-1 rounded-full overflow-hidden bg-[var(--bg-surface)]">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      tone === 'bad' ? 'bg-[var(--error)]' : tone === 'warn' ? 'bg-amber-500' : 'bg-emerald-500',
                    )}
                    style={{ width: `${Math.min(100, Math.max(2, share * 100))}%` }}
                  />
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

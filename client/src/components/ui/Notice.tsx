import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { TONE, type Tone } from './tone';

/**
 * A message about the state of things - the one way the app says
 * "this has stopped", "worth a look" or "all is well".
 *
 * White, not tinted: the colour is a rule down the leading edge and the
 * icon, so a page with two notices on it is not two coloured slabs, and a
 * warning reads as a warning because of the words and the mark beside them.
 *
 * `card` sits in a page's flow; `band` runs edge to edge inside a pane
 * (the inbox list, a drawer) with a hairline under it.
 */
export function Notice({
  tone = 'neutral',
  icon: Icon,
  title,
  children,
  action,
  onDismiss,
  variant = 'card',
  className,
  ...rest
}: {
  tone?: Tone;
  icon?: LucideIcon;
  /** The headline, when there is one; otherwise `children` is the message. */
  title?: ReactNode;
  children?: ReactNode;
  /** A link or button, set on the right. */
  action?: ReactNode;
  onDismiss?: () => void;
  variant?: 'card' | 'band';
  className?: string;
  [key: `data-${string}`]: string | undefined;
}) {
  return (
    <div
      role={tone === 'negative' ? 'alert' : 'status'}
      className={cn(
        'relative flex items-start gap-2.5 overflow-hidden bg-[var(--bg-surface)] pl-4 pr-3 py-2.5',
        variant === 'card'
          ? 'rounded-lg border border-[var(--border-subtle)] shadow-[var(--shadow-sm)]'
          : 'border-b border-[var(--border-subtle)] flex-shrink-0',
        className,
      )}
      {...rest}
    >
      <span aria-hidden className={cn('absolute left-0 inset-y-0 w-[3px]', TONE[tone].solid)} />
      {Icon && <Icon className={cn('mt-[3px] h-3.5 w-3.5 flex-shrink-0', TONE[tone].icon)} strokeWidth={2} />}
      <div className="min-w-0 flex-1 text-body leading-relaxed text-[var(--text-primary)]">
        {title && <p className="font-semibold leading-snug">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5 text-caption text-[var(--text-secondary)]')}>{children}</div>}
      </div>
      {action && <div className="flex-shrink-0 self-center">{action}</div>}
      {onDismiss && (
        <button onClick={onDismiss} title="Dismiss" className="flex-shrink-0 self-center rounded p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

/** The action inside a notice: an ink text link. */
export function NoticeAction({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className={cn('text-body font-semibold text-[var(--indigo)] hover:underline underline-offset-2 disabled:opacity-50', props.className)}>
      {children}
    </button>
  );
}

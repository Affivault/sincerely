import { cn } from '../../lib/utils';
import type { CampaignStatus, ContactCampaignStatus } from '@lemlist/shared';

const DOT = 'inline-block w-1.5 h-1.5 rounded-full mr-1 flex-shrink-0';

const campaignConfig: Record<string, { pill: string; dot: string }> = {
  draft:     { pill: 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)]', dot: 'bg-[var(--text-tertiary)]' },
  scheduled: { pill: 'bg-blue-500/8 text-blue-600 dark:text-blue-400 border border-blue-500/15',                                    dot: 'bg-blue-500' },
  running:   { pill: 'bg-emerald-500/8 text-emerald-600 dark:text-emerald-400 border border-emerald-500/15',                           dot: 'bg-emerald-500' },
  paused:    { pill: 'bg-amber-500/8 text-amber-600 dark:text-amber-400 border border-amber-500/15',                                 dot: 'bg-amber-500' },
  completed: { pill: 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)]', dot: 'bg-[var(--text-tertiary)]' },
  cancelled: { pill: 'bg-[var(--error-bg)] text-[var(--error)] border border-[var(--error-border)]',             dot: 'bg-[var(--error)]' },
};

const contactConfig: Record<string, { pill: string; dot: string }> = {
  pending:      { pill: 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)]', dot: 'bg-[var(--text-tertiary)]' },
  active:       { pill: 'bg-emerald-500/8 text-emerald-600 dark:text-emerald-400 border border-emerald-500/15',                           dot: 'bg-emerald-500' },
  completed:    { pill: 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)]', dot: 'bg-[var(--text-tertiary)]' },
  replied:      { pill: 'bg-blue-500/8 text-blue-600 dark:text-blue-400 border border-blue-500/15',                                    dot: 'bg-blue-500' },
  bounced:      { pill: 'bg-[var(--error-bg)] text-[var(--error)] border border-[var(--error-border)]',             dot: 'bg-[var(--error)]' },
  unsubscribed: { pill: 'bg-amber-500/8 text-amber-600 dark:text-amber-400 border border-amber-500/15',                                 dot: 'bg-amber-500' },
  error:        { pill: 'bg-[var(--error-bg)] text-[var(--error)] border border-[var(--error-border)]',             dot: 'bg-[var(--error)]' },
  suppressed:   { pill: 'bg-purple-500/8 text-purple-600 dark:text-purple-400 border border-purple-500/15',          dot: 'bg-purple-500' },
};

const fallback = { pill: 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)]', dot: 'bg-[var(--text-tertiary)]' };

interface StatusBadgeProps {
  status: CampaignStatus | ContactCampaignStatus | string;
  type?: 'campaign' | 'contact';
}

export function StatusBadge({ status, type = 'campaign' }: StatusBadgeProps) {
  const configMap = type === 'campaign' ? campaignConfig : contactConfig;
  const { pill, dot } = configMap[status] || fallback;

  return (
    <span className={cn('inline-flex items-center h-[18px] rounded-[4px] px-1.5 text-[11px] font-medium leading-none whitespace-nowrap', pill)}>
      <span className={cn(DOT, dot)} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

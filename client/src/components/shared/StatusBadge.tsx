import { cn } from '../../lib/utils';
import { TONE, type Tone } from '../ui/tone';
import type { CampaignStatus, ContactCampaignStatus } from '@lemlist/shared';

const DOT = 'inline-block w-1.5 h-1.5 rounded-full mr-1 flex-shrink-0';

/* What each state means, in the shared status language (see ui/tone). */
const campaignTone: Record<string, Tone> = {
  draft: 'neutral', scheduled: 'info', running: 'positive', paused: 'attention', completed: 'neutral', cancelled: 'negative',
};
const contactTone: Record<string, Tone> = {
  pending: 'neutral', active: 'positive', completed: 'neutral', replied: 'info', bounced: 'negative',
  unsubscribed: 'attention', error: 'negative', paused: 'attention', suppressed: 'neutral',
};

interface StatusBadgeProps {
  status: CampaignStatus | ContactCampaignStatus | string;
  type?: 'campaign' | 'contact';
}

export function StatusBadge({ status, type = 'campaign' }: StatusBadgeProps) {
  const tone = (type === 'campaign' ? campaignTone : contactTone)[status] || 'neutral';
  const pill = `${TONE[tone].bg} ${TONE[tone].text}`;
  const dot = TONE[tone].solid;

  return (
    <span className={cn('inline-flex items-center h-[18px] rounded px-1.5 text-caption font-medium leading-none whitespace-nowrap', pill)}>
      <span className={cn(DOT, dot)} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

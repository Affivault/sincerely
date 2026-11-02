import { AlertTriangle } from 'lucide-react';
import { Notice, NoticeAction } from '../ui/Notice';

/**
 * Said wherever deals are drawn by stage when the pipelines did not load.
 * The built-in Lead / Qualified / Proposal stages stand in meanwhile, so the
 * deals are still there to see; this says why the stages look plainer.
 */
export function PipelinesFailedNotice({ onRetry, className }: { onRetry: () => void; className?: string }) {
  return (
    <Notice
      tone="attention"
      icon={AlertTriangle}
      title="Your pipeline stages did not load"
      action={<NoticeAction type="button" onClick={onRetry}>Try again</NoticeAction>}
      className={className}
      live
    >
      Deals are shown in the three basic stages until they do. Nothing has been changed.
    </Notice>
  );
}

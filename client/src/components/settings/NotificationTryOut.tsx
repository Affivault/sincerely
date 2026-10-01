import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Loader2, Send } from 'lucide-react';
import { notifyApi } from '../../api/notify.api';
import { Button } from '../ui/Button';

/**
 * See a notification and the digest for real, rather than wait for Monday.
 * Both go out whatever the switches above say: you asked for them.
 */
export function NotificationTryOut() {
  const test = useMutation({
    mutationFn: notifyApi.test,
    onSuccess: (r) => r.sent
      ? toast.success(`Sent from ${r.from} to ${r.to}.`)
      : toast.error(!r.from ? 'Connect a mailbox first - notifications are sent from it.' : 'It could not be sent. Check the mailbox on the Email accounts page.'),
    onError: () => toast.error('It could not be sent. Try again in a moment.'),
  });
  const digest = useMutation({
    mutationFn: notifyApi.digest,
    onSuccess: (r) => r.sent ? toast.success(`Sent: "${r.subject}"`) : toast.error('The digest could not be sent. Check that a mailbox is connected and working.'),
    onError: () => toast.error('The digest could not be sent. Try again in a moment.'),
  });
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[var(--border-subtle)] px-4 py-3" data-notify-tryout>
      <p className="mr-auto text-body text-[var(--text-secondary)]">See what they look like in your inbox.</p>
      <Button size="sm" variant="secondary" onClick={() => test.mutate()} disabled={test.isPending}>
        {test.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Send a test
      </Button>
      <Button size="sm" variant="secondary" onClick={() => digest.mutate()} disabled={digest.isPending}>
        {digest.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Send last week&apos;s digest
      </Button>
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { inboxApi } from '../api/inbox.api';
import { useAuth } from '../context/AuthContext';

// Pure data read — this hook is called from multiple components (Sidebar,
// AppLayout) that are always mounted together, so any side effect placed
// here (desktop notifications, document.title) would fire once per mount
// and double up. Side effects live in a single top-level subscriber instead
// (see AppLayout's useUnreadNotifications).
export function useUnreadCount() {
  const { user } = useAuth();

  const { data: count = 0 } = useQuery({
    queryKey: ['inbox-unread-count'],
    queryFn: inboxApi.unreadCount,
    refetchInterval: 30_000,
    enabled: !!user,
    staleTime: 20_000,
  });

  return count;
}

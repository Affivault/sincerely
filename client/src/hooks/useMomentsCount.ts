import { useQuery } from '@tanstack/react-query';
import { signalsApi } from '../api/signals.api';
import { useAuth } from '../context/AuthContext';

/**
 * How many Moments are waiting. A pure data read, like useUnreadCount: the
 * Sidebar and the section bar both show it. The key sits under ['moments'],
 * so acting on or dismissing a moment refreshes it.
 */
export function useMomentsCount() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ['moments', 'count'],
    queryFn: signalsApi.count,
    refetchInterval: 5 * 60_000,
    staleTime: 2 * 60_000,
    enabled: !!user,
    retry: false,
  });
  return data?.count ?? 0;
}

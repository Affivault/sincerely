import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { inboxApi } from '../api/inbox.api';
import { useAuth } from '../context/AuthContext';

export function useUnreadCount() {
  const { user } = useAuth();
  const prevCountRef = useRef<number>(0);

  const { data: count = 0 } = useQuery({
    queryKey: ['inbox-unread-count'],
    queryFn: inboxApi.unreadCount,
    refetchInterval: 30_000,
    enabled: !!user,
    staleTime: 20_000,
  });

  useEffect(() => {
    if (count > prevCountRef.current && prevCountRef.current > 0) {
      const diff = count - prevCountRef.current;
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('SkySend Inbox', {
          body: `You have ${diff} new message${diff !== 1 ? 's' : ''}`,
          icon: '/favicon.svg',
        });
      }
    }
    prevCountRef.current = count;
  }, [count]);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  return count;
}

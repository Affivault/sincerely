import { useQuery } from '@tanstack/react-query';
import { billingApi } from '../api/billing.api';

/*
 * Whether the signed-in account is the platform owner. The server says so,
 * on the billing summary every page already loads, and says nothing at all
 * to anyone else: the owner's address and the admin backend are not in the
 * client code for anybody to find.
 */
export function useIsOwner(): { isOwner: boolean; loading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ['billing', 'usage'],
    queryFn: billingApi.usage,
    staleTime: 60_000,
  });
  return { isOwner: data?.isOwner === true, loading: isLoading };
}

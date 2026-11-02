import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { setAccountCurrency, getAccountCurrency } from '@lemlist/shared';
import { settingsApi } from '../api/settings.api';

/*
 * The currency the account chose in Settings, made the default for every
 * money figure that has no currency of its own. Set during render, not in an
 * effect, so the page drawn in this same pass already uses it. Returns the
 * code, which the shell keys the page on: a change redraws every figure.
 */
export function useAccountCurrency(): string {
  const { data } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get, staleTime: 60_000 });
  return useMemo(() => {
    setAccountCurrency(data?.currency);
    return getAccountCurrency();
  }, [data?.currency]);
}

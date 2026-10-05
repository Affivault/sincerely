import axios from 'axios';
import { apiClient } from './client';
import { API_URL } from '../lib/constants';
import type { ResultsPeriodKey, ResultsReport, ResultsShare, SharedResults } from '@lemlist/shared';

export const resultsApi = {
  report: async (period: ResultsPeriodKey) =>
    (await apiClient.get<ResultsReport>('/results', { params: { period }, timeout: 45_000 })).data,
  shares: async () => (await apiClient.get<ResultsShare[]>('/results/shares')).data,
  share: async (input: { period: ResultsPeriodKey; title?: string; show_campaigns: boolean }) =>
    (await apiClient.post<ResultsShare>('/results/shares', input)).data,
  revoke: async (id: string) => (await apiClient.delete<{ revoked: boolean }>(`/results/shares/${id}`)).data,
};

/*
 * The shared page is opened by people without an account, so it never
 * sends a session - the same rule as the public booking page.
 */
const publicClient = axios.create({ baseURL: API_URL.replace(/\/v1\/?$/, '') + '/report', timeout: 45_000 });

export const publicResultsApi = {
  open: async (token: string) => (await publicClient.get<SharedResults>(`/${encodeURIComponent(token)}`)).data,
};

/** The address to hand out. */
export function sharedResultsUrl(token: string): string {
  return `${window.location.origin}/r/${token}`;
}

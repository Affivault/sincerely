import { apiClient } from './client';
import type { SearchResults } from '@lemlist/shared';

export const searchApi = {
  /** Every object type the user owns, in one request. */
  query: async (q: string) =>
    (await apiClient.get<SearchResults>('/search', { params: { q } })).data,
};

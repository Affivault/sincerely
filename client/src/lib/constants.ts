export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

export const CAMPAIGN_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  scheduled: 'bg-blue-100 text-blue-700',
  running: 'bg-green-100 text-green-700',
  paused: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-purple-100 text-purple-700',
  cancelled: 'bg-red-100 text-red-700',
};

export const CONTACT_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  active: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  replied: 'bg-purple-100 text-purple-700',
  bounced: 'bg-red-100 text-red-700',
  unsubscribed: 'bg-orange-100 text-orange-700',
  error: 'bg-red-100 text-red-700',
};

export const DEFAULT_PAGE_SIZE = 25;

/** Rows-per-page choices offered in list views.
 *  Capped at 100 because the API clamps `limit` there (server/src/utils/
 *  pagination.ts) — offering more would silently return 100 and skip rows. */
export const PAGE_SIZE_OPTIONS = [25, 50, 75, 100];

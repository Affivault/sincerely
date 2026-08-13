export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

/**
 * The same address, guaranteed absolute.
 *
 * `VITE_API_URL` is legitimately relative on any deployment that proxies the
 * API under the app's own origin (`/api/v1` behind a Vercel rewrite, say) —
 * axios is perfectly happy with that, so nothing inside the app ever noticed.
 *
 * The Chrome extension is a different program in a different origin, and a
 * relative path means nothing to it. It was being handed `/api/v1`, quietly
 * rejecting it as unusable, and falling back to the default host baked into
 * the extension — so the key handshake reported success while every request
 * afterwards went somewhere the account does not exist. Resolving it here
 * means everything that leaves this app carries an address that works from
 * outside it.
 */
export const ABSOLUTE_API_URL = (() => {
  try {
    return new URL(API_URL, window.location.origin).href.replace(/\/+$/, '');
  } catch {
    return API_URL;
  }
})();

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

/** Headcount buckets, matching the ranges the prospector filters on so a
 *  company sized here can be found by the same search later. */
export const COMPANY_SIZE_OPTIONS = [
  { value: '', label: 'Headcount unknown' },
  { value: '1-10', label: '1–10' },
  { value: '11-50', label: '11–50' },
  { value: '51-200', label: '51–200' },
  { value: '201-500', label: '201–500' },
  { value: '501-1000', label: '501–1,000' },
  { value: '1001-5000', label: '1,001–5,000' },
  { value: '5001-10000', label: '5,001–10,000' },
  { value: '10001+', label: '10,000+' },
];

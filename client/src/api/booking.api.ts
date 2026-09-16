import axios from 'axios';
import { apiClient } from './client';
import { API_URL } from '../lib/constants';
import type {
  BookingLink, CreateBookingLinkInput,
  PublicBookingPage, CreateBookingInput, BookingConfirmation,
} from '@lemlist/shared';

/** The account's own links. Authenticated like everything else. */
export const bookingLinksApi = {
  list: async () => (await apiClient.get<BookingLink[]>('/booking-links')).data,

  create: async (input: CreateBookingLinkInput) =>
    (await apiClient.post<BookingLink>('/booking-links', input)).data,

  update: async (id: string, input: CreateBookingLinkInput) =>
    (await apiClient.patch<BookingLink>(`/booking-links/${id}`, input)).data,

  archive: async (id: string) =>
    (await apiClient.delete<{ archived: boolean }>(`/booking-links/${id}`)).data,

  bookings: async (id: string) =>
    (await apiClient.get<any[]>(`/booking-links/${id}/bookings`)).data,

  /** Whether a booking can send a confirmation at all. */
  readiness: async () =>
    (await apiClient.get<{ can_email: boolean }>('/booking-links/readiness')).data,
};

/* ═══════════════════════════════════════════════════════════════════════
   The public pages.

   A separate axios instance, on purpose. The shared client attaches a
   Supabase token to every request, and these pages are opened by people who
   do not have one - but they are also sometimes opened by the account
   itself, to check its own link. Sending a session token to a public
   endpoint that ignores it is harmless; sending it from a page that is
   meant to prove the anonymous path works is how you ship a booking page
   that only works while you are logged in.
   ═══════════════════════════════════════════════════════════════════════ */

// API_URL ends in /api/v1; the public booking routes sit beside it at /api/book.
const PUBLIC_BASE = API_URL.replace(/\/v1\/?$/, '') + '/book';

const publicClient = axios.create({
  baseURL: PUBLIC_BASE,
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
});

export interface WireSlot { start: string; end: string }

export const publicBookingApi = {
  page: async (slug: string) =>
    (await publicClient.get<PublicBookingPage>(`/${encodeURIComponent(slug)}`)).data,

  slots: async (slug: string, from: string, to: string) =>
    (await publicClient.get<WireSlot[]>(`/${encodeURIComponent(slug)}/slots`, {
      params: { from, to },
    })).data,

  book: async (slug: string, input: CreateBookingInput) =>
    (await publicClient.post<BookingConfirmation>(`/${encodeURIComponent(slug)}`, input)).data,

  byToken: async (token: string) =>
    (await publicClient.get<BookingConfirmation>(`/manage/${encodeURIComponent(token)}`)).data,

  rescheduleSlots: async (token: string, from: string, to: string) =>
    (await publicClient.get<WireSlot[]>(`/manage/${encodeURIComponent(token)}/slots`, {
      params: { from, to },
    })).data,

  reschedule: async (token: string, start: string) =>
    (await publicClient.post<BookingConfirmation>(
      `/manage/${encodeURIComponent(token)}/reschedule`, { start })).data,

  cancel: async (token: string, reason?: string) =>
    (await publicClient.post<BookingConfirmation>(
      `/manage/${encodeURIComponent(token)}/cancel`, { reason })).data,

  /** Absolute, because it is put in an href rather than fetched. */
  icsUrl: (token: string) => `${PUBLIC_BASE}/manage/${encodeURIComponent(token)}/ics`,
};

/** The address to give somebody, which is this app's origin, not the API's. */
export function publicBookingUrl(slug: string): string {
  return `${window.location.origin}/b/${slug}`;
}

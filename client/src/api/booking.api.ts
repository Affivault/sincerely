import axios from 'axios';
import { apiClient } from './client';
import { API_URL } from '../lib/constants';
import type {
  BookingLink, CreateBookingLinkInput,
  PublicBookingPage, CreateBookingInput, BookingConfirmation,
  BookingLinkHost, HostedRoundRobinLink, RoundRobinStatus,
} from '@lemlist/shared';

/** A list the UI maps over straight away; anything else is an error, not a crash. */
function list<T>(data: unknown, what: string): T[] {
  if (!Array.isArray(data)) throw new Error(`${what} could not be loaded`);
  return data as T[];
}

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

  /** Reply to a thread with the account's link, in one action. */
  sendLinkInReply: async (messageId: string, note?: string) =>
    (await apiClient.post<{ sent: boolean; url: string }>(
      `/booking-links/reply/${messageId}`, { note })).data,

  /* ── Round robin (097) ── */

  /** The team switch, and who on the team could host. */
  roundRobin: async () => {
    const { data } = await apiClient.get<RoundRobinStatus>('/team/round-robin');
    if (!data || typeof data.enabled !== 'boolean' || !Array.isArray(data.members)) {
      throw new Error('Round-robin settings could not be loaded');
    }
    return data;
  },

  setRoundRobin: async (enabled: boolean) =>
    (await apiClient.put<RoundRobinStatus>('/team/round-robin', { enabled })).data,

  hosts: async (id: string) =>
    list<BookingLinkHost>((await apiClient.get(`/booking-links/${id}/hosts`)).data, 'Hosts'),

  setHosts: async (id: string, hosts: { user_id: string; priority: number; is_active: boolean }[]) =>
    list<BookingLinkHost>((await apiClient.put(`/booking-links/${id}/hosts`, { hosts })).data, 'Hosts'),

  /** Round-robin links the signed-in person takes meetings for. */
  hosting: async () =>
    list<HostedRoundRobinLink>((await apiClient.get('/booking-links/hosting')).data, 'Your round-robin links'),

  setHostingPaused: async (linkId: string, paused: boolean) =>
    list<HostedRoundRobinLink>((await apiClient.put(`/booking-links/hosting/${linkId}`, { paused })).data, 'Your round-robin links'),

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
  page: async (slug: string, k?: string) =>
    (await publicClient.get<PublicBookingPage>(`/${encodeURIComponent(slug)}`, {
      params: k ? { k } : undefined,
    })).data,

  slots: async (slug: string, from: string, to: string) =>
    (await publicClient.get<WireSlot[]>(`/${encodeURIComponent(slug)}/slots`, {
      params: { from, to },
    })).data,

  book: async (slug: string, input: CreateBookingInput, k?: string) =>
    (await publicClient.post<BookingConfirmation>(`/${encodeURIComponent(slug)}`, input, {
      params: k ? { k } : undefined,
    })).data,

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

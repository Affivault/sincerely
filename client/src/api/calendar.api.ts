import { apiClient } from './client';
import type { CalendarEventType, CreateEventTypeInput, AvailabilityWindow, SchedulingPrefs } from '@lemlist/shared';

/** Kinds of meeting: the calendar's colour vocabulary. */
export const calendarApi = {
  listTypes: async () => (await apiClient.get<CalendarEventType[]>('/calendar/types')).data,

  createType: async (input: CreateEventTypeInput) =>
    (await apiClient.post<CalendarEventType>('/calendar/types', input)).data,

  updateType: async (id: string, input: Partial<CreateEventTypeInput>) =>
    (await apiClient.patch<CalendarEventType>(`/calendar/types/${id}`, input)).data,

  /** Retires it. Meetings already booked keep their colour. */
  archiveType: async (id: string) =>
    (await apiClient.delete<{ archived: boolean; events: number }>(`/calendar/types/${id}`)).data,
};

export interface AvailabilityResponse {
  windows: AvailabilityWindow[];
  prefs: SchedulingPrefs;
}

/** When you are free, and the rules around a booking. */
export const availabilityApi = {
  get: async () =>
    (await apiClient.get<AvailabilityResponse>('/calendar/availability')).data,

  /** The whole week at once — a partial save is how a day goes missing. */
  replaceWindows: async (windows: AvailabilityWindow[]) =>
    (await apiClient.put<AvailabilityWindow[]>('/calendar/availability', { windows })).data,

  updatePrefs: async (patch: Partial<SchedulingPrefs>) =>
    (await apiClient.patch<SchedulingPrefs>('/calendar/availability/prefs', patch)).data,

  /* ── Calendars kept elsewhere ── */

  connections: async () =>
    (await apiClient.get<{
      available: boolean;
      connections: {
        id: string; provider: string; account_email: string | null;
        read_busy: boolean; write_events: boolean;
        broken_at: string | null; broken_reason: string | null;
        last_synced_at: string | null;
      }[];
    }>('/calendar/connections')).data,

  authorizeGoogle: async () =>
    (await apiClient.get<{ url: string }>('/calendar/connections/authorize')).data,

  updateConnection: async (id: string, input: { read_busy?: boolean; write_events?: boolean }) =>
    (await apiClient.patch(`/calendar/connections/${id}`, input)).data,

  disconnect: async (id: string) =>
    (await apiClient.delete(`/calendar/connections/${id}`)).data,

  /** What could be offered, straight from the server that would honour it. */
  slots: async (params: { from: string; to: string; duration: number }) =>
    (await apiClient.get<{ start: string; end: string }[]>('/calendar/slots', { params })).data,
};

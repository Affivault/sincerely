import { apiClient } from './client';
import type { CalendarEventType, CreateEventTypeInput } from '@lemlist/shared';

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

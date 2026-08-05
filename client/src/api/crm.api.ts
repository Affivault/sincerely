import { apiClient } from './client';
import type {
  Deal, CreateDealInput, UpdateDealInput,
  CrmTask, CreateTaskInput, UpdateTaskInput,
  CrmEvent, CreateEventInput, UpdateEventInput,
  CrmNote, CreateNoteInput, UpdateNoteInput,
  ContactCrmSummary,
} from '@lemlist/shared';

export const crmApi = {
  // Deals
  listDeals: async (params?: { contact_id?: string; contact_email?: string }) =>
    (await apiClient.get<Deal[]>('/crm/deals', { params })).data,
  createDeal: async (input: CreateDealInput) => (await apiClient.post<Deal>('/crm/deals', input)).data,
  updateDeal: async (id: string, input: UpdateDealInput) => (await apiClient.put<Deal>(`/crm/deals/${id}`, input)).data,
  deleteDeal: async (id: string) => { await apiClient.delete(`/crm/deals/${id}`); },

  // Tasks
  listTasks: async (params?: { contact_id?: string; deal_id?: string }) =>
    (await apiClient.get<CrmTask[]>('/crm/tasks', { params })).data,
  createTask: async (input: CreateTaskInput) => (await apiClient.post<CrmTask>('/crm/tasks', input)).data,
  updateTask: async (id: string, input: UpdateTaskInput) => (await apiClient.put<CrmTask>(`/crm/tasks/${id}`, input)).data,
  deleteTask: async (id: string) => { await apiClient.delete(`/crm/tasks/${id}`); },

  // Events (calendar)
  listEvents: async (params?: { from?: string; to?: string; contact_id?: string; deal_id?: string }) =>
    (await apiClient.get<CrmEvent[]>('/crm/events', { params })).data,
  createEvent: async (input: CreateEventInput) => (await apiClient.post<CrmEvent>('/crm/events', input)).data,
  updateEvent: async (id: string, input: UpdateEventInput) => (await apiClient.put<CrmEvent>(`/crm/events/${id}`, input)).data,
  deleteEvent: async (id: string) => { await apiClient.delete(`/crm/events/${id}`); },

  // Notes
  listNotes: async (params?: { contact_id?: string; deal_id?: string }) =>
    (await apiClient.get<CrmNote[]>('/crm/notes', { params })).data,
  createNote: async (input: CreateNoteInput) => (await apiClient.post<CrmNote>('/crm/notes', input)).data,
  updateNote: async (id: string, input: UpdateNoteInput) => (await apiClient.put<CrmNote>(`/crm/notes/${id}`, input)).data,
  deleteNote: async (id: string) => { await apiClient.delete(`/crm/notes/${id}`); },

  /** Deals, activities, meetings and notes for one contact, in one request. */
  contactSummary: async (contactId: string) =>
    (await apiClient.get<ContactCrmSummary>(`/crm/contact/${contactId}/summary`)).data,
};

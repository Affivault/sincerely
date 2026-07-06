import { apiClient } from './client';
import type {
  Deal, CreateDealInput, UpdateDealInput,
  CrmTask, CreateTaskInput, UpdateTaskInput,
  CrmEvent, CreateEventInput, UpdateEventInput,
} from '@lemlist/shared';

export const crmApi = {
  // Deals
  listDeals: async (params?: { contact_id?: string; contact_email?: string }) =>
    (await apiClient.get<Deal[]>('/crm/deals', { params })).data,
  createDeal: async (input: CreateDealInput) => (await apiClient.post<Deal>('/crm/deals', input)).data,
  updateDeal: async (id: string, input: UpdateDealInput) => (await apiClient.put<Deal>(`/crm/deals/${id}`, input)).data,
  deleteDeal: async (id: string) => { await apiClient.delete(`/crm/deals/${id}`); },

  // Tasks
  listTasks: async () => (await apiClient.get<CrmTask[]>('/crm/tasks')).data,
  createTask: async (input: CreateTaskInput) => (await apiClient.post<CrmTask>('/crm/tasks', input)).data,
  updateTask: async (id: string, input: UpdateTaskInput) => (await apiClient.put<CrmTask>(`/crm/tasks/${id}`, input)).data,
  deleteTask: async (id: string) => { await apiClient.delete(`/crm/tasks/${id}`); },

  // Events (calendar)
  listEvents: async (params?: { from?: string; to?: string }) =>
    (await apiClient.get<CrmEvent[]>('/crm/events', { params })).data,
  createEvent: async (input: CreateEventInput) => (await apiClient.post<CrmEvent>('/crm/events', input)).data,
  updateEvent: async (id: string, input: UpdateEventInput) => (await apiClient.put<CrmEvent>(`/crm/events/${id}`, input)).data,
  deleteEvent: async (id: string) => { await apiClient.delete(`/crm/events/${id}`); },
};

import { apiClient } from './client';
import type { WebhookEndpoint, CreateWebhookEndpointInput, UpdateWebhookEndpointInput, WebhookDelivery } from '@lemlist/shared';

export const webhookApi = {
  listEndpoints: async () => {
    const { data } = await apiClient.get<WebhookEndpoint[]>('/webhooks/endpoints');
    return data;
  },

  getEndpoint: async (id: string) => {
    const { data } = await apiClient.get<WebhookEndpoint>(`/webhooks/endpoints/${id}`);
    return data;
  },

  createEndpoint: async (input: CreateWebhookEndpointInput) => {
    const { data } = await apiClient.post<WebhookEndpoint>('/webhooks/endpoints', input);
    return data;
  },

  updateEndpoint: async (id: string, input: UpdateWebhookEndpointInput) => {
    const { data } = await apiClient.put<WebhookEndpoint>(`/webhooks/endpoints/${id}`, input);
    return data;
  },

  deleteEndpoint: async (id: string) => {
    await apiClient.delete(`/webhooks/endpoints/${id}`);
  },

  testEndpoint: async (id: string) => {
    const { data } = await apiClient.post<{ success: boolean; status_code: number | null }>(`/webhooks/endpoints/${id}/test`);
    return data;
  },

  regenerateSecret: async (id: string) => {
    const { data } = await apiClient.post<WebhookEndpoint>(`/webhooks/endpoints/${id}/regenerate-secret`);
    return data;
  },

  getDeliveries: async (endpointId?: string, limit?: number) => {
    const params: Record<string, string> = {};
    if (endpointId) params.endpoint_id = endpointId;
    if (limit) params.limit = String(limit);
    const { data } = await apiClient.get<WebhookDelivery[]>('/webhooks/deliveries', { params });
    return data;
  },

  redeliverDelivery: async (deliveryId: string) => {
    const { data } = await apiClient.post<WebhookDelivery>(`/webhooks/deliveries/${deliveryId}/redeliver`);
    return data;
  },
};

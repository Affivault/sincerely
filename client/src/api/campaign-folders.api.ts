import { apiClient } from './client';

export interface CampaignFolder {
  id: string;
  name: string;
  color: string;
  icon: string;
  position: number;
  parent_id: string | null;
  campaign_count: number;
  created_at: string;
}

export interface FolderAnalytics {
  folder: CampaignFolder;
  campaigns: Array<{
    id: string;
    name: string;
    status: string;
    total_contacts: number;
    sent: number;
    opened: number;
    clicked: number;
    replied: number;
    bounced: number;
    open_rate: number;
    click_rate: number;
    reply_rate: number;
  }>;
  totals: {
    sent: number;
    opened: number;
    clicked: number;
    replied: number;
    bounced: number;
  };
}

export const campaignFoldersApi = {
  list: async () => {
    const { data } = await apiClient.get<CampaignFolder[]>('/campaign-folders');
    return data;
  },
  create: async (input: { name: string; color?: string; icon?: string; parent_id?: string | null }) => {
    const { data } = await apiClient.post<CampaignFolder>('/campaign-folders', input);
    return data;
  },
  update: async (id: string, input: Partial<{ name: string; color: string; icon: string; position: number; parent_id: string | null }>) => {
    const { data } = await apiClient.patch<CampaignFolder>(`/campaign-folders/${id}`, input);
    return data;
  },
  delete: async (id: string) => {
    await apiClient.delete(`/campaign-folders/${id}`);
  },
  moveCampaign: async (campaignId: string, folderId: string | null) => {
    await apiClient.post('/campaign-folders/move', { campaign_id: campaignId, folder_id: folderId });
  },
  analytics: async (folderId: string) => {
    const { data } = await apiClient.get<FolderAnalytics>(`/campaign-folders/${folderId}/analytics`);
    return data;
  },
};

import { apiClient } from './client';

export interface PublicApiInfo { base_url: string; openapi_url: string; version: string }

export interface ApiRequestLogRow {
  id: number;
  api_key_id: string | null;
  key_name: string | null;
  request_id: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  error_code: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface ApiRequestLog {
  setup_needed: boolean;
  rows: ApiRequestLogRow[];
  last_day: { requests: number; errors: number };
}

export const developerApi = {
  info: async () => (await apiClient.get<PublicApiInfo>('/api-keys/public-api')).data,
  requestLog: async (opts: { errorsOnly?: boolean; keyId?: string } = {}) => {
    const params: Record<string, string> = {};
    if (opts.errorsOnly) params.errors = '1';
    if (opts.keyId) params.key = opts.keyId;
    return (await apiClient.get<ApiRequestLog>('/api-keys/request-log', { params })).data;
  },
};

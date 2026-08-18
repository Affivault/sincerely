import { apiClient } from './client';

export interface TrackingDomain {
  id: string;
  domain: string;
  verified: boolean;
  verified_at: string | null;
  last_error: string | null;
  last_checked_at: string | null;
}

export interface CnameInstruction {
  type: 'CNAME';
  host: string;
  name: string;
  value: string;
  ttl: number;
}

export interface TrackingDomainCheck {
  label: string;
  ok: boolean;
  detail: string;
}

export interface TrackingDomainState {
  domain: TrackingDomain | null;
  cname: CnameInstruction | null;
  /** The host every customer CNAME points at. */
  target: string;
}

export const trackingDomainApi = {
  get: async () => {
    const { data } = await apiClient.get<TrackingDomainState>('/tracking-domain');
    return data;
  },
  set: async (domain: string) => {
    const { data } = await apiClient.put<TrackingDomainState>('/tracking-domain', { domain });
    return data;
  },
  /** Re-checks DNS and HTTPS; activates only when both pass. */
  verify: async () => {
    const { data } = await apiClient.post<TrackingDomain & { checks: TrackingDomainCheck[] }>(
      '/tracking-domain/verify',
    );
    return data;
  },
  remove: async () => {
    await apiClient.delete('/tracking-domain');
  },
};

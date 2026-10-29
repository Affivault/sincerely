import axios from 'axios';
import { CREDIT_PRICES, PLANS, type PlanId, type PublicPlatformInfo } from '@lemlist/shared';
import { API_URL } from './constants';

/*
 * The owners change plan limits, credit prices, sign-ups and the
 * announcement without a deploy. The server publishes them at /api/platform
 * (no sign-in needed); this reads them and writes the prices and limits
 * over the shared PLANS and CREDIT_PRICES, so every screen that quotes a
 * price or a limit quotes the live one.
 */

const PLATFORM_URL = API_URL.replace(/\/v1\/?$/, '') + '/platform';

export async function fetchPlatform(): Promise<PublicPlatformInfo> {
  const { data } = await axios.get<PublicPlatformInfo>(PLATFORM_URL, { timeout: 10_000 });
  if (data?.credit_prices) Object.assign(CREDIT_PRICES, data.credit_prices);
  if (data?.plans) {
    for (const id of Object.keys(data.plans) as PlanId[]) if (PLANS[id]) Object.assign(PLANS[id], data.plans[id]);
  }
  return data;
}

export const platformQuery = {
  queryKey: ['platform'] as const,
  queryFn: fetchPlatform,
  staleTime: 60_000,
  refetchInterval: 5 * 60_000,
  retry: 1,
};

const REFUSED = 'sincerely:signup-refused';

/**
 * "Continue with Google" for someone sign-ups do not admit comes back with
 * the database's refusal in the address. Noted here, before the app
 * redirects it away, for the sign-in page to explain.
 */
export function claimSignupRefusal() {
  try {
    const raw = `${window.location.hash} ${window.location.search}`;
    if (/error_description=[^&]*(Database\+error\+saving\+new\+user|Database%20error%20saving%20new%20user|SIGNUPS_CLOSED)/i.test(raw)) {
      sessionStorage.setItem(REFUSED, '1');
    }
  } catch { /* storage blocked */ }
}

export function takeSignupRefusal(): boolean {
  try {
    if (!sessionStorage.getItem(REFUSED)) return false;
    sessionStorage.removeItem(REFUSED);
    return true;
  } catch { return false; }
}

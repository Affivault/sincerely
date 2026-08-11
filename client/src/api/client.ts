import axios from 'axios';
import { supabase } from '../lib/supabase';
import { API_URL } from '../lib/constants';
import { notifyUpgrade } from '../lib/upgradeNag';

const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach Supabase auth token to every request
apiClient.interceptors.request.use(async (config) => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      config.headers.Authorization = `Bearer ${session.access_token}`;
    }
  } catch {
    // Auth service unavailable — proceed without token
  }
  return config;
});

// Handle 401 responses
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    /*
     * Fold the server's reference id into the message the UI will show.
     * Failures that can't be explained get one, and it is the only thing that
     * ties what someone saw on screen to the line in the server log — without
     * it, "it didn't work" is where diagnosis starts and usually ends.
     */
    const payload = error.response?.data;
    if (payload?.ref && typeof payload.error === 'string' && !payload.error.includes(payload.ref)) {
      payload.error = `${payload.error} (ref ${payload.ref})`;
    }

    // Plan-limit hit — pop the upgrade modal.
    if (error.response?.status === 403 && error.response?.data?.code === 'UPGRADE_REQUIRED') {
      notifyUpgrade(error.response.data.error);
    }
    if (error.config && error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true;
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        await supabase.auth.signOut();
        window.location.href = '/login';
      } else {
        // Refresh succeeded — retry the original request once with the new token
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          error.config.headers.Authorization = `Bearer ${session.access_token}`;
          return apiClient(error.config);
        }
        // Refresh reported success but produced no usable token — force sign-out
        await supabase.auth.signOut();
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export { apiClient };

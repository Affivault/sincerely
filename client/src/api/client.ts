import axios from 'axios';
import { supabase } from '../lib/supabase';
import { API_URL } from '../lib/constants';
import { notifyUpgrade } from '../lib/upgradeNag';
import { rememberReturnTo } from '../lib/returnTo';

/** Off to sign in again, keeping the page they were on to come back to. */
function toLogin() {
  rememberReturnTo(`${window.location.pathname}${window.location.search}${window.location.hash}`);
  window.location.href = '/login';
}

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
     * No response at all: the request never got an answer the browser could
     * read - a dropped connection, a proxy 502 while the server restarts, a
     * laptop waking from sleep. axios calls every one of these "Network
     * Error", and nearly every handler in the app shows err.message, so that
     * phrase was what people saw, with no hint of what to do.
     *
     * A read is safe to repeat, so it is retried once after a short pause -
     * which is all a proxy blip or a restart needs. Writes are not retried
     * (the server may have acted on them); they get a message that says
     * what probably happened instead.
     */
    if (!error.response && error.config && !axios.isCancel(error)) {
      const method = String(error.config.method || 'get').toLowerCase();
      const timedOut = error.code === 'ECONNABORTED' || /timeout/i.test(error.message || '');
      if (method === 'get' && !timedOut && !error.config._netRetry) {
        error.config._netRetry = true;
        await new Promise((r) => setTimeout(r, 800));
        return apiClient(error.config);
      }
      error.message = timedOut
        ? 'The server took too long to answer. It may be busy - try again in a moment.'
        : typeof navigator !== 'undefined' && navigator.onLine === false
          ? 'You appear to be offline. Check your connection and try again.'
          : 'Could not reach Sincerely just now. Please try again - if it keeps happening, refresh the page.';
    }

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
      let refreshError: any = null;
      try {
        ({ error: refreshError } = await supabase.auth.refreshSession());
      } catch (e) {
        refreshError = e;
      }
      if (refreshError) {
        // Only a definitive auth rejection ends the session. A network blip
        // (offline laptop waking up) must not log the user out and discard
        // their unsaved work; surface the original 401 instead.
        const status = refreshError.status;
        if (status === 400 || status === 401 || status === 403) {
          await supabase.auth.signOut();
          toLogin();
        }
      } else {
        // Refresh succeeded — retry the original request once with the new token
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          error.config.headers.Authorization = `Bearer ${session.access_token}`;
          return apiClient(error.config);
        }
        // Refresh reported success but produced no usable token — force sign-out
        await supabase.auth.signOut();
        toLogin();
      }
    }
    return Promise.reject(error);
  }
);

export { apiClient };

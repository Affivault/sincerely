import axios from 'axios';
import { supabase } from '../lib/supabase';
import { API_URL } from '../lib/constants';

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
    if (error.response?.status === 401) {
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        await supabase.auth.signOut();
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export { apiClient };

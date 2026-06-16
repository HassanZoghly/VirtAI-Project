import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { CSRF_HEADER_NAME, ensureCsrfToken } from './csrfService';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const API_PREFIX = '/api/v1';

function normalizeApiUrl(url?: string): string | undefined {
  if (typeof url !== 'string') {
    return url;
  }

  if (url === API_PREFIX) {
    return '/';
  }

  if (url.startsWith(`${API_PREFIX}/`)) {
    return url.slice(API_PREFIX.length);
  }

  return url;
}

interface ApiAuthHandlers {
  getToken: () => string | null;
  getHasSessionHint: () => boolean;
  refreshToken: () => Promise<{ access_token: string }>;
  markSession: () => void;
  clearSession: () => void;
  logout: () => void;
  setToken: (token: string) => void;
}

let authHandlers: ApiAuthHandlers | null = null;

export function injectApiAuthHandlers(handlers: ApiAuthHandlers) {
  authHandlers = handlers;
}

const apiClient: AxiosInstance = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
  xsrfCookieName: 'csrf_token',
  xsrfHeaderName: 'X-CSRF-Token',
});

if (typeof window !== 'undefined') {
  void ensureCsrfToken();
}

apiClient.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  config.url = normalizeApiUrl(config.url);
  config.headers = config.headers || {};
  const method = config.method?.toUpperCase() ?? 'GET';

  if (STATE_CHANGING_METHODS.has(method)) {
    const csrfToken = await ensureCsrfToken();
    if (!csrfToken) {
      throw new Error('Unable to obtain CSRF token for state-changing request.');
    }
    config.headers.set(CSRF_HEADER_NAME, csrfToken);
  }

  if (authHandlers) {
    const token = authHandlers.getToken();
    if (token) {
      config.headers.set('Authorization', `Bearer ${token}`);
    }
  }

  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (!original || !authHandlers) {
      return Promise.reject(error);
    }

    const hasRefreshCandidate = authHandlers.getToken() || authHandlers.getHasSessionHint();
    
    // Check if original object has _retry property (using type casting since it's custom)
    const isRetry = (original as any)._retry;

    if (error.response?.status === 401 && !isRetry && hasRefreshCandidate) {
      (original as any)._retry = true;
      try {
        const resData = await authHandlers.refreshToken();
        authHandlers.markSession();
        authHandlers.setToken(resData.access_token);
        
        original.headers = original.headers || {};
        original.headers.set('Authorization', `Bearer ${resData.access_token}`);
        
        return apiClient(original);
      } catch (err) {
        authHandlers.clearSession();
        authHandlers.logout();
        return Promise.reject(error);
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;

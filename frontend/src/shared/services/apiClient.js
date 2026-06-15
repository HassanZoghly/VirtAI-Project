import { refreshAccessTokenSingleFlight } from '@/features/auth/services/refreshService';
import { useAuthStore } from '@/features/auth/store/authStore';
import {
  clearBrowserAuthState,
  hasBrowserAuthSessionHint,
  markBrowserAuthSession,
} from '@/features/auth/services/authStateCleanup';
import axios from 'axios';
import { ensureCsrfToken, CSRF_HEADER_NAME } from './csrfService';

// CSRF logic moved to csrfService

function setRequestHeader(headers, name, value) {
  if (!headers) {
    return { [name]: value };
  }

  if (typeof headers.set === 'function') {
    headers.set(name, value);
    return headers;
  }

  headers[name] = value;
  return headers;
}

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const API_PREFIX = '/api/v1';

function normalizeApiUrl(url) {
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

// ensureCsrfToken moved to csrfService

const apiClient = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
  xsrfCookieName: 'csrf_token',
  xsrfHeaderName: 'X-CSRF-Token',
});

if (typeof window !== 'undefined') {
  void ensureCsrfToken();
}

apiClient.interceptors.request.use(async (config) => {
  config.url = normalizeApiUrl(config.url);
  const method = config.method?.toUpperCase() ?? 'GET';

  if (STATE_CHANGING_METHODS.has(method)) {
    const csrfToken = await ensureCsrfToken();
    if (!csrfToken) {
      throw new Error('Unable to obtain CSRF token for state-changing request.');
    }
    config.headers = setRequestHeader(config.headers, CSRF_HEADER_NAME, csrfToken);
  }

  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers = setRequestHeader(config.headers, 'Authorization', `Bearer ${token}`);
  }

  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const hasRefreshCandidate = useAuthStore.getState().accessToken || hasBrowserAuthSessionHint();
    if (error.response?.status === 401 && !original._retry && hasRefreshCandidate) {
      original._retry = true;
      try {
        const resData = await refreshAccessTokenSingleFlight();
        markBrowserAuthSession();
        // Only update the token — never touch the user object mid-flight.
        // setAuth(store.user, token) would wipe user to null if initAuth
        // hasn't finished populating it yet (e.g. on hard page refresh).
        useAuthStore.setState({ accessToken: resData.access_token });
        original.headers = setRequestHeader(
          original.headers || {},
          'Authorization',
          `Bearer ${resData.access_token}`
        );
        return apiClient(original);
      } catch {
        clearBrowserAuthState();
        useAuthStore.getState().logout();
        return Promise.reject(error);
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;

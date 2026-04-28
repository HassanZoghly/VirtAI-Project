import { refreshAccessTokenSingleFlight } from '@/features/auth/services/refreshService';
import { useAuthStore } from '@/features/auth/store/authStore';
import axios from 'axios';

const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'X-CSRF-Token';
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

let csrfTokenRequest = null;

function readCookie(name) {
  if (typeof document === 'undefined') {
    return null;
  }

  const cookiePrefix = `${name}=`;
  const cookies = document.cookie ? document.cookie.split('; ') : [];

  for (const cookie of cookies) {
    if (cookie.startsWith(cookiePrefix)) {
      return decodeURIComponent(cookie.slice(cookiePrefix.length));
    }
  }

  return null;
}

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

async function ensureCsrfToken() {
  if (typeof document === 'undefined') {
    return null;
  }

  const existingToken = readCookie(CSRF_COOKIE_NAME);
  if (existingToken) {
    return existingToken;
  }

  if (!csrfTokenRequest) {
    csrfTokenRequest = axios
      .get('/api/v1/auth/csrf', { withCredentials: true })
      .catch((error) => {
        console.error('Failed to fetch initial CSRF token:', error);
        return null;
      })
      .finally(() => {
        csrfTokenRequest = null;
      });
  }

  await csrfTokenRequest;
  return readCookie(CSRF_COOKIE_NAME);
}

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
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const resData = await refreshAccessTokenSingleFlight();
        // Only update the token — never touch the user object mid-flight.
        // setAuth(store.user, token) would wipe user to null if initAuth
        // hasn't finished populating it yet (e.g. on hard page refresh).
        useAuthStore.setState({ accessToken: resData.access_token });
        original.headers.Authorization = `Bearer ${resData.access_token}`;
        return apiClient(original);
      } catch {
        useAuthStore.getState().logout();
        return Promise.reject(error);
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;

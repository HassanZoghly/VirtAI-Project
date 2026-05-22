import axios from 'axios';
import {
  clearBrowserAuthState,
  isInvalidRefreshResponse,
  markBrowserAuthSession,
} from './authStateCleanup';

let refreshPromise = null;

const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'X-CSRF-Token';

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

async function ensureCsrfToken() {
  const existingToken = readCookie(CSRF_COOKIE_NAME);
  if (existingToken) {
    return existingToken;
  }

  await axios.get('/api/v1/auth/csrf', { withCredentials: true });
  return readCookie(CSRF_COOKIE_NAME);
}

/**
 * Single-flight refresh token queue.
 * Ensures concurrent requests or double-mounts merge into a single `/auth/refresh` API request
 * to prevent revoking the refresh token for parallel calls.
 */
export function refreshAccessTokenSingleFlight() {
  if (refreshPromise) {
    return refreshPromise;
  }

  // Use bare axios to bypass apiClient interceptors and avoid infinite 401 loops
  refreshPromise = (async () => {
    const csrfToken = await ensureCsrfToken();
    if (!csrfToken) {
      throw new Error('Unable to obtain CSRF token for refresh request.');
    }

    try {
      const response = await axios.post('/api/v1/auth/refresh', null, {
        withCredentials: true,
        headers: { [CSRF_HEADER_NAME]: csrfToken },
      });

      markBrowserAuthSession();
      return response.data;
    } catch (error) {
      if (isInvalidRefreshResponse(error)) {
        clearBrowserAuthState();
      }
      throw error;
    }
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

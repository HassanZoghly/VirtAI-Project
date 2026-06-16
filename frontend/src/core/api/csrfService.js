import axios from 'axios';
import { logger } from '@/shared/utils/logger';

export const CSRF_COOKIE_NAME = 'csrf_token';
export const CSRF_HEADER_NAME = 'X-CSRF-Token';

let csrfTokenRequest = null;

export function readCookie(name) {
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

export async function ensureCsrfToken() {
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
        logger.error('Failed to fetch initial CSRF token:', error);
        return null;
      })
      .finally(() => {
        csrfTokenRequest = null;
      });
  }

  await csrfTokenRequest;
  return readCookie(CSRF_COOKIE_NAME);
}

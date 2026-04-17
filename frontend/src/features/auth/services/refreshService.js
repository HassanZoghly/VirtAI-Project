import axios from 'axios';

let refreshPromise = null;

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
  refreshPromise = axios.post('/api/v1/auth/refresh', null, {
    withCredentials: true,
  })
    .then((res) => res.data)
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

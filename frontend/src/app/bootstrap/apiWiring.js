import { injectApiAuthHandlers } from '@/core/api/apiClient';
import { useAuthStore } from '@/features/auth/store/authStore';
import { refreshAccessTokenSingleFlight } from '@/features/auth/services/refreshService';
import { clearBrowserAuthState, hasBrowserAuthSessionHint, markBrowserAuthSession } from '@/features/auth/services/authStateCleanup';

/**
 * Connects the core API client with the Auth feature module.
 * This Inversion of Control pattern keeps `core/api` ignorant of `features/auth`.
 */
export function setupApiAuthWiring() {
  injectApiAuthHandlers({
    getToken: () => useAuthStore.getState().accessToken,
    getHasSessionHint: () => hasBrowserAuthSessionHint(),
    refreshToken: () => refreshAccessTokenSingleFlight(),
    markSession: () => markBrowserAuthSession(),
    clearSession: () => clearBrowserAuthState(),
    logout: () => useAuthStore.getState().logout(),
    setToken: (token) => useAuthStore.setState({ accessToken: token }),
  });
}

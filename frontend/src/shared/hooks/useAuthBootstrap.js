import { useEffect, useRef } from 'react';
import { hasBrowserAuthSessionHint } from '@/features/auth/services/authStateCleanup';
import { useAuthStore } from '@/features/auth/store/authStore';

export default function useAuthBootstrap() {
  const bootstrapStartedRef = useRef(false);

  // ALWAYS attempt a silent refresh on app boot — regardless of pathname.
  // This ensures the auth state is resolved before any routing decisions.
  useEffect(() => {
    if (bootstrapStartedRef.current) {
      return;
    }

    bootstrapStartedRef.current = true;

    const pathname = window.location.pathname;
    // Skip for OAuth callback (it has its own flow)
    if (pathname.startsWith('/auth/callback')) {
      // Mark as initialized so the callback page can render
      useAuthStore.setState({ isInitialized: true, isInitializing: false });
      return;
    }

    const protectedPath = pathname.startsWith('/setup') || pathname.startsWith('/classroom');
    const shouldAttemptRefresh = protectedPath || hasBrowserAuthSessionHint();

    if (!shouldAttemptRefresh) {
      useAuthStore.setState({ isInitialized: true, isInitializing: false, isLoading: false });
      return;
    }

    void useAuthStore.getState().initAuth({ forceRefresh: protectedPath });
  }, []);
}

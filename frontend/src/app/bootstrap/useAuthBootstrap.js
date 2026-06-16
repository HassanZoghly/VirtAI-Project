import { useEffect, useRef } from 'react';
import { hasBrowserAuthSessionHint } from '@/features/auth/services/authStateCleanup';
import { useAuthStore } from '@/features/auth/store/authStore';
import { shouldSkipAuthRefresh, isProtectedPath, shouldAttemptRefresh } from '@/features/auth/utils/authDecisions';

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
    
    if (shouldSkipAuthRefresh(pathname)) {
      useAuthStore.setState({ isInitialized: true, isInitializing: false, isLoading: false });
      return;
    }

    const protectedPath = isProtectedPath(pathname);
    const attemptRefresh = shouldAttemptRefresh(pathname, hasBrowserAuthSessionHint());

    if (!attemptRefresh) {
      useAuthStore.setState({ isInitialized: true, isInitializing: false, isLoading: false });
      return;
    }

    void useAuthStore.getState().initAuth({ forceRefresh: protectedPath });
  }, []);
}

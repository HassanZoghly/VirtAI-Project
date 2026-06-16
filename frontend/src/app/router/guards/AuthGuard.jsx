import { useShallow } from 'zustand/react/shallow';
import { selectIsAuthenticated, useAuthStore } from '@/features/auth/store/authStore';
import { Navigate, useLocation } from 'react-router-dom';
import PageLoader from '@/shared/components/PageLoader';

export default function AuthGuard({ children }) {
  const { isAuthenticated, user } = useAuthStore(
    useShallow((s) => ({
      isAuthenticated: selectIsAuthenticated(s),
      user: s.user,
    }))
  );
  const location = useLocation();

  // 1. User is not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/auth" replace />;
  }

  // 2. Auth resolved, user loaded — check setup status
  if (!user) {
    return <PageLoader />;
  }

  const setupDone = !!user?.setupComplete;

  // Force users who haven't completed setup to the setup page,
  // but do NOT block users who have completed it from revisiting /setup.
  if (!setupDone && !location.pathname.startsWith('/setup')) {
    return <Navigate to="/setup" replace />;
  }

  return children;
}

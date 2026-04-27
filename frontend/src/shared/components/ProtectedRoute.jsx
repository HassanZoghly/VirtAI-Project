import { useAuthStore, selectIsAuthenticated } from '@/features/auth/store/authStore';
import { Navigate, useLocation } from 'react-router-dom';
import PageLoader from './PageLoader';

export default function ProtectedRoute({ children }) {
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (isLoading) {
    return <PageLoader />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth" replace />;
  }

  if (!user) {
    return <PageLoader />;
  }

  const setupDone = !!user?.setupComplete;

  // Force users who haven't completed setup to the setup page,
  // but do NOT block users who have completed it from revisiting /setup
  // (they may want to change avatar/voice settings).
  if (!setupDone && !location.pathname.startsWith('/setup')) {
    return <Navigate to="/setup" replace />;
  }

  return children;
}

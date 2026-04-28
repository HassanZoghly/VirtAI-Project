import { selectIsAuthenticated, useAuthStore } from '@/features/auth/store/authStore';
import { Navigate, useLocation } from 'react-router-dom';
import PageLoader from './PageLoader';

export default function ProtectedRoute({ children }) {
  const isInitializing = useAuthStore((s) => s.isInitializing);
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  // 1. Auth hasn't been attempted yet — wait (handled by App.jsx gate,
  //    but keep as safety net for direct deep-link rendering)
  if (isInitializing || !isInitialized || isLoading) {
    return <PageLoader />;
  }

  // 2. Auth resolved, user is not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/auth" replace />;
  }

  // 3. Auth resolved, user loaded — check setup status
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

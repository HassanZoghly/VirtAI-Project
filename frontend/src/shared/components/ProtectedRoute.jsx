import { useAuthStore } from '@/features/auth/store/authStore';
import { Navigate } from 'react-router-dom';
import PageLoader from './PageLoader';

export default function ProtectedRoute({ children }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const user = useAuthStore((s) => s.user);

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

  if (!setupDone && !window.location.pathname.startsWith('/setup')) {
    return <Navigate to="/setup" replace />;
  }

  if (setupDone && window.location.pathname.startsWith('/setup')) {
    return <Navigate to="/classroom" replace />;
  }

  return children;
}

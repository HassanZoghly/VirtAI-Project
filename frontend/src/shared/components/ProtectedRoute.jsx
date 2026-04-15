import { useAuthStore } from '@/features/auth/store/authStore';
import { loadSetup } from '@/features/setup/services/setupStorage';
import { Navigate } from 'react-router-dom';
import PageLoader from './PageLoader';

export default function ProtectedRoute({ children }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);

  if (isLoading) {
    return <PageLoader />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth" replace />;
  }

  const setupDone = loadSetup() !== null;

  if (!setupDone && !window.location.pathname.startsWith('/setup')) {
    return <Navigate to="/setup" replace />;
  }

  return children;
}

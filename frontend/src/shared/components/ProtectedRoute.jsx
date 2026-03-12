import { useAuthStore } from '@/features/auth/store/authStore';
import { loadSetup } from '@/features/setup/services/setupStorage';
import { Navigate } from 'react-router-dom';

export default function ProtectedRoute({ children }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-(--primary-bg)">
        <div className="w-10 h-10 border-4 border-(--accent-primary) border-t-transparent rounded-full animate-spin" />
      </div>
    );
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

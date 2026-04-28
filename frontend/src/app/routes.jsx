import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';

import Overview from '../pages/OverviewPage';
import PageLoader from '@/shared/components/PageLoader';

const Classroom = lazy(() => import('../pages/ClassroomPage'));
const Setup = lazy(() => import('../pages/SetupPage'));
const NotFound = lazy(() => import('../pages/NotFoundPage'));
const AuthPage = lazy(() => import('../pages/AuthPage'));
const AuthCallbackHandler = lazy(() => import('../pages/AuthCallbackPage'));
const ProtectedRoute = lazy(() => import('@/shared/components/ProtectedRoute'));

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Overview />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/auth/callback" element={<AuthCallbackHandler />} />
      <Route
        path="/setup"
        element={
          <Suspense fallback={<PageLoader />}>
            <ProtectedRoute>
              <Setup />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/classroom"
        element={
          <Suspense fallback={<PageLoader />}>
            <ProtectedRoute>
              <Classroom />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

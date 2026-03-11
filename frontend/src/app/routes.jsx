import { lazy } from 'react';
import { Route, Routes } from 'react-router-dom';

import ProtectedRoute from '@/shared/components/ProtectedRoute';

export const preloadClassroom = () => import('../pages/ClassroomPage');
export const preloadSetup = () => import('../pages/SetupPage');

const Classroom = lazy(preloadClassroom);
const Setup = lazy(preloadSetup);
const Overview = lazy(() => import('../pages/OverviewPage'));
const NotFound = lazy(() => import('../pages/NotFoundPage'));
const AuthPage = lazy(() => import('../pages/AuthPage'));
const AuthCallbackHandler = lazy(() => import('../pages/AuthCallbackPage'));

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Overview />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/auth/callback" element={<AuthCallbackHandler />} />
      <Route
        path="/setup"
        element={
          <ProtectedRoute>
            <Setup />
          </ProtectedRoute>
        }
      />
      <Route
        path="/classroom"
        element={
          <ProtectedRoute>
            <Classroom />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

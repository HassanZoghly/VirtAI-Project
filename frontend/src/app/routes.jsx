import { lazy } from 'react';
import { Route, Routes } from 'react-router-dom';

const Overview = lazy(() => import('../pages/Overview'));
const Classroom = lazy(() => import('../pages/Classroom'));
const Setup = lazy(() => import('../pages/Setup'));
const NotFound = lazy(() => import('../pages/NotFound'));
const AuthPage = lazy(() => import('../pages/Auth'));
const AuthCallbackHandler = lazy(() => import('../pages/AuthCallback'));

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Overview />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/auth/callback" element={<AuthCallbackHandler />} />
      <Route path="/setup" element={<Setup />} />
      <Route path="/classroom/:sessionId?" element={<Classroom />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

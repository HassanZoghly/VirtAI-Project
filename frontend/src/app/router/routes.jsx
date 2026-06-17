import { Component, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import RequireAuth from './guards/RequireAuth';
import RequireSetupComplete from './guards/RequireSetupComplete';

const Overview = lazy(() => import('@/pages/Overview'));
const Classroom = lazy(() => import('@/pages/Classroom'));
const Setup = lazy(() => import('@/pages/Setup'));
const NotFound = lazy(() => import('@/pages/NotFound'));
const AuthPage = lazy(() => import('@/pages/Auth'));
const AuthCallbackHandler = lazy(() => import('@/pages/AuthCallback'));

class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] p-4 text-center">
          <h2 className="text-xl font-bold text-red-500 mb-2">Failed to load section</h2>
          <p className="text-sm text-gray-400 mb-4">{this.state.error?.message || 'A loading error occurred.'}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={
        <RequireAuth>
          <RequireSetupComplete>
            <RouteErrorBoundary><Overview /></RouteErrorBoundary>
          </RequireSetupComplete>
        </RequireAuth>
      } />

      {/* Public routes */}
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/auth/callback" element={<AuthCallbackHandler />} />

      {/* Protected routes */}
      <Route path="/setup" element={
        <RequireAuth>
          <RouteErrorBoundary><Setup /></RouteErrorBoundary>
        </RequireAuth>
      } />
      <Route path="/classroom/:sessionId?" element={
        <RequireAuth>
          <RequireSetupComplete>
            <RouteErrorBoundary><Classroom /></RouteErrorBoundary>
          </RequireSetupComplete>
        </RequireAuth>
      } />

      {/* Catch-all */}
      <Route path="*" element={<RouteErrorBoundary><NotFound /></RouteErrorBoundary>} />
    </Routes>
  );
}

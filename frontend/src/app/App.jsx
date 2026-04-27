import { Component, Suspense, useEffect } from 'react';
import { Helmet, HelmetProvider } from 'react-helmet-async';
import { BrowserRouter as Router } from 'react-router-dom';
import './App.css';

import PageLoader from '@/shared/components/PageLoader';
import { Toaster } from 'sonner';
import AppRoutes from './routes';

const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true };

/**
 * Top-level error boundary that catches render errors and shows a fallback UI.
 * @param {{ children: React.ReactNode }} props
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, errorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="error-fallback" role="alert" aria-live="assertive">
          <h2>Something went wrong</h2>
          <p>Please refresh the page or try again later.</p>
          <button onClick={() => window.location.reload()}>Refresh</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  useEffect(() => {
    const pathname = window.location.pathname;
    const shouldRestoreSession =
      pathname !== '/' && !pathname.startsWith('/auth/callback');

    if (!shouldRestoreSession) {
      return;
    }

    let cancelled = false;
    const restoreSession = async () => {
      const { useAuthStore } = await import('@/features/auth/store/authStore');
      if (!cancelled) {
        await useAuthStore.getState().initAuth();
      }
    };

    restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <HelmetProvider>
      <Helmet>
        <title>Classroom App</title>
        <meta name="description" content="Interactive learning platform" />
      </Helmet>

      <Router future={ROUTER_FUTURE}>
        <div className="app">
          <Toaster richColors position="top-right" />
          <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>
              <AppRoutes />
            </Suspense>
          </ErrorBoundary>
        </div>
      </Router>
    </HelmetProvider>
  );
}

export default App;

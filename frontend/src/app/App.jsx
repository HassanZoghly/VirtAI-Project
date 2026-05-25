import { Component, Suspense, useEffect, useRef } from 'react';
import { Helmet, HelmetProvider } from 'react-helmet-async';
import { BrowserRouter as Router } from 'react-router-dom';
import './App.css';

import { hasBrowserAuthSessionHint } from '@/features/auth/services/authStateCleanup';
import { useAuthStore } from '@/features/auth/store/authStore';
import PageLoader from '@/shared/components/PageLoader';
import useVisualViewport from '@/shared/hooks/useVisualViewport';
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
          <h2 className="display-h2">Something went wrong</h2>
          <p>Please refresh the page or try again later.</p>
          <button onClick={() => window.location.reload()}>Refresh</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  useVisualViewport();
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const isInitializing = useAuthStore((s) => s.isInitializing);
  const isLoading = useAuthStore((s) => s.isLoading);
  const bootstrapStartedRef = useRef(false);

  // ALWAYS attempt a silent refresh on app boot — regardless of pathname.
  // This ensures the auth state is resolved before any routing decisions.
  useEffect(() => {
    if (bootstrapStartedRef.current) {
      return;
    }

    bootstrapStartedRef.current = true;

    const pathname = window.location.pathname;
    // Skip for OAuth callback (it has its own flow)
    if (pathname.startsWith('/auth/callback')) {
      // Mark as initialized so the callback page can render
      useAuthStore.setState({ isInitialized: true, isInitializing: false });
      return;
    }

    const protectedPath = pathname.startsWith('/setup') || pathname.startsWith('/classroom');
    const shouldAttemptRefresh = protectedPath || hasBrowserAuthSessionHint();

    if (!shouldAttemptRefresh) {
      useAuthStore.setState({ isInitialized: true, isInitializing: false, isLoading: false });
      return;
    }

    void useAuthStore.getState().initAuth({ forceRefresh: protectedPath });
  }, []);

  // Block ALL route rendering until the auth check completes.
  // This prevents the flash: "unauthenticated → redirect to /auth → actually authenticated"
  if (isInitializing || !isInitialized || isLoading) {
    return <PageLoader />;
  }

  return (
    <HelmetProvider>
      <Helmet>
        <title>Classroom App</title>
        <meta name="description" content="Interactive learning platform" />
      </Helmet>

      <Router future={ROUTER_FUTURE}>
        <div className="app">
          <Toaster richColors position="top-right" theme="dark" />
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

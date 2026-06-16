import { Component, Suspense } from 'react';
import { Helmet, HelmetProvider } from 'react-helmet-async';
import { BrowserRouter as Router } from 'react-router-dom';
import './App.css';

import { useAuthStore } from '@/features/auth/store/authStore';
import PageLoader from '@/shared/components/PageLoader';
import useAuthBootstrap from '@/shared/hooks/useAuthBootstrap';
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
    // TODO: Send error to Sentry or another monitoring service in production
    // Sentry.captureException(error, { extra: errorInfo });
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

  useAuthBootstrap();

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

      <ErrorBoundary>
        <Router future={ROUTER_FUTURE}>
          <div className="app">
            <Toaster richColors position="top-right" theme="dark" toastOptions={{ style: { transition: 'transform 0.3s ease-out, opacity 0.3s ease-out, box-shadow 0.3s ease-out' } }} />
            <Suspense fallback={<PageLoader />}>
              <AppRoutes />
            </Suspense>
          </div>
        </Router>
      </ErrorBoundary>
    </HelmetProvider>
  );
}

export default App;

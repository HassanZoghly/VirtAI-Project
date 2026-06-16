import { Component, Suspense } from 'react';
import { Helmet } from 'react-helmet-async';
import { Toaster } from 'sonner';
import PageLoader from '@/shared/components/PageLoader';

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

export default function AppShell({ children }) {
  return (
    <ErrorBoundary>
      <Helmet>
        <title>Classroom App</title>
        <meta name="description" content="Interactive learning platform" />
      </Helmet>

      <div className="app">
        <Toaster 
          richColors 
          position="top-right" 
          theme="dark" 
          toastOptions={{ 
            style: { 
              transition: 'transform 0.3s ease-out, opacity 0.3s ease-out, box-shadow 0.3s ease-out' 
            } 
          }} 
        />
        <Suspense fallback={<PageLoader />}>
          {children}
        </Suspense>
      </div>
    </ErrorBoundary>
  );
}

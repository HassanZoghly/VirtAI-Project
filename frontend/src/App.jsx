import { Component, lazy, Suspense, useEffect } from 'react';
import { Helmet, HelmetProvider } from 'react-helmet-async';
import { Navigate, Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import './App.css';

const preloadClassroom = () => import('./pages/Classroom/Classroom.jsx');
const Classroom = lazy(preloadClassroom);
const Overview = lazy(() => import('@/features/overview/components/OverviewPage'));

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
        <div className="error-fallback" role="alert">
          <h2>Something went wrong</h2>
          <p>Please refresh the page or try again later.</p>
          <button onClick={() => window.location.reload()}>Refresh</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function PageLoader() {
  return (
    <div className="page-loader">
      <div className="loader">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  );
}

function App() {
  useEffect(() => {
    preloadClassroom();
  }, []);

  return (
    <HelmetProvider>
      <Helmet>
        <title>Classroom App</title>
        <meta name="description" content="Interactive learning platform" />
      </Helmet>

      <Router future={ROUTER_FUTURE}>
        <div className="app">
          <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<Overview />} />
                <Route path="/classroom" element={<Classroom />} />
                <Route path="*" element={<Navigate to="/classroom" replace />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </div>
      </Router>
    </HelmetProvider>
  );
}

export default App;

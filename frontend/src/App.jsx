import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense, useEffect, Component } from "react";
import { HelmetProvider, Helmet } from "react-helmet-async";
import "./App.css";

const preloadClassroom = () => import("./pages/Classroom/Classroom.jsx");
const Classroom = lazy(preloadClassroom);

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, errorInfo) {
    console.error("Error caught by boundary:", error, errorInfo);
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
      <div className="loader"></div>
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

      <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <div className="app">
          <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<Navigate to="/classroom" replace />} />
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
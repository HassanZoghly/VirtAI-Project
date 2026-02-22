import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { lazy, Suspense, useState, useEffect } from "react";
import "./App.css";

// Lazy pages (code-splitting)
const Overview  = lazy(() => import("./pages/Overview/Overview.jsx"));
const Setup     = lazy(() => import("./pages/Setup/Setup.jsx"));
const Classroom = lazy(() => import("./pages/Classroom/Classroom.jsx"));
const NotFound  = lazy(() => import("./pages/NotFound/NotFound.jsx"));

function PageFallback() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 300);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  return (
    <div className="page-loading" role="status" aria-live="polite">
      <div className="loading-ring" aria-hidden="true">
        <div /><div /><div /><div />
      </div>
      <span className="loading-text">Loading…</span>
    </div>
  );
}

function AppRoutes() {
  return (
    <div className="app">
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/"          element={<Overview />}  />
          <Route path="/setup"     element={<Setup />}     />
          <Route path="/classroom" element={<Classroom />} />
          <Route path="*"          element={<NotFound />}  />
        </Routes>
      </Suspense>
    </div>
  );
}

function App() {
  return (
      <Router>
        <AppRoutes />
      </Router>
  );
}

export default App;
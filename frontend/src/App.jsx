import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { lazy, Suspense } from "react";
import "./App.css";

// Record the exact moment the JS bundle first executes.
// Used to guarantee spinner is visible for ≥ 1 s on every hard refresh.
const APP_START = performance.now();

/**
 * Wraps a dynamic import so that it resolves in at most:
 *   max(actualLoadTime, 1000ms − timeAlreadySpentLoading)
 * On subsequent in-session navigations the chunk is cached and the
 * remaining budget is 0, so no artificial delay is added.
 */
const minDelay = (fn) => () =>
  Promise.all([
    fn(),
    new Promise((r) =>
      setTimeout(r, Math.max(0, 1000 - (performance.now() - APP_START)))
    ),
  ]).then(([mod]) => mod);

// Lazy pages (code-splitting) — each guaranteed ≥ 1 s on first load
const Overview  = lazy(minDelay(() => import("./pages/Overview/Overview.jsx")));
const Setup     = lazy(minDelay(() => import("./pages/Setup/Setup.jsx")));
const Classroom = lazy(minDelay(() => import("./pages/Classroom/Classroom.jsx")));
const NotFound  = lazy(minDelay(() => import("./pages/NotFound/NotFound.jsx")));

function PageFallback() {
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
      <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppRoutes />
      </Router>
  );
}

export default App;
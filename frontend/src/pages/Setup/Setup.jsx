import { lazy, Suspense } from 'react';
import './Setup.css';

const SetupPage = lazy(() => import('@/features/setup/components/SetupPage'));

function SetupFallback() {
  return (
    <div className="setup-fallback" role="status" aria-label="Loading setup">
      <div className="loader">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <span className="fallback-text">Preparing setup...</span>
    </div>
  );
}

export default function Setup() {
  return (
    <div className="setup-page">
      <Suspense fallback={<SetupFallback />}>
        <SetupPage />
      </Suspense>
    </div>
  );
}

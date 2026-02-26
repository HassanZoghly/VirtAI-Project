import { lazy, Suspense } from "react";
import "./Classroom.css";

const ClassroomShell = lazy(() => import("./components/ClassroomShell.jsx"));

function ShellFallback() {
  return (
    <div className="shell-fallback" role="status" aria-label="Loading classroom shell">
      <div className="fallback-spinner" />
      <span className="fallback-text">Loading classroom...</span>
    </div>
  );
}

export default function Classroom() {
  return (
    <div className="classroom-page">
      <Suspense fallback={<ShellFallback />}>
        <ClassroomShell />
      </Suspense>
    </div>
  );
}
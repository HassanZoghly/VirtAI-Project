import '@/widgets/Classroom/Classroom.css';
import { lazy, Suspense } from 'react';

import ProtectedRoute from '@/shared/components/ProtectedRoute';

const ClassroomShell = lazy(() => import('@/widgets/Classroom/ClassroomShell'));

function ShellFallback() {
  return (
    <div className="shell-fallback" role="status">
      <div className="loader">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  );
}

export default function Classroom() {
  return (
    <ProtectedRoute>
      <div className="classroom-page">
        <Suspense fallback={<ShellFallback />}>
          <ClassroomShell />
        </Suspense>
      </div>
    </ProtectedRoute>
  );
}

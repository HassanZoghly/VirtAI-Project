import './Setup.css';

import { SetupPage } from '@/features/setup';
import ProtectedRoute from '@/shared/components/ProtectedRoute';

export default function Setup() {
  return (
    <ProtectedRoute>
      <SetupPage />
    </ProtectedRoute>
  );
}

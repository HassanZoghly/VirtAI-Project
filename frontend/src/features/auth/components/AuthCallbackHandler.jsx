import { useGoogleCallback } from '@/features/auth/hooks/useAuth';
import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

export default function AuthCallbackHandler() {
  const [searchParams] = useSearchParams();
  const { handleCallback, isLoading } = useGoogleCallback();
  const navigate = useNavigate();
  const called = useRef(false);

  useEffect(() => {
    const code = searchParams.get('code');
    if (!code) {
      navigate('/auth', { replace: true });
      return;
    }
    if (called.current) return;
    called.current = true;
    handleCallback(code);
  }, [searchParams, handleCallback, navigate]);

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-[var(--primary-bg)]">
      <div className="w-12 h-12 border-4 border-[var(--accent-primary)] border-t-transparent rounded-full animate-spin" />
      {isLoading && (
        <p className="mt-4 text-[var(--text-secondary)] text-sm">Completing sign-in…</p>
      )}
    </div>
  );
}

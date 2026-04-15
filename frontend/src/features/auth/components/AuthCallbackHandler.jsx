import { useGoogleCallback } from '@/features/auth/hooks/useAuth';
import PageLoader from '@/shared/components/PageLoader';
import { useEffect, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate, useSearchParams } from 'react-router-dom';

export default function AuthCallbackHandler() {
  const [searchParams] = useSearchParams();
  const { handleCallback } = useGoogleCallback();
  const navigate = useNavigate();
  const called = useRef(false);

  useEffect(() => {
    const code = searchParams.get('code');
    if (!code) {
      navigate('/auth', { replace: true });
      return;
    }
    if (called.current) {
      return;
    }
    called.current = true;
    handleCallback(code);
  }, [searchParams, handleCallback, navigate]);

  return (
    <>
      <Helmet>
        <title>Signing in… — VirtAI</title>
      </Helmet>
      <PageLoader />
    </>
  );
}

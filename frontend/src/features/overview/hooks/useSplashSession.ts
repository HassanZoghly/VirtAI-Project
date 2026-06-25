import { useEffect, useState } from 'react';

interface SplashSessionOptions {
  isNavbarReady: boolean;
  prefersReducedMotion: boolean;
}

export function useSplashSession({ isNavbarReady, prefersReducedMotion }: SplashSessionOptions) {
  const [showSplash, setShowSplash] = useState(false);

  useEffect(() => {
    if (!isNavbarReady || prefersReducedMotion) {
      return;
    }

    let alreadySeenSplash = false;
    try {
      alreadySeenSplash = sessionStorage.getItem('virtai:overview-splash-seen') === '1';
    } catch (e) {
      // ignore security restrictions on storage access
    }

    if (alreadySeenSplash) {
      return;
    }

    let idleId: number | null = null;
    let timeoutId: any = null;
    let cancelled = false;

    const triggerSplash = () => {
      if (!cancelled) {
        setShowSplash(true);
      }
    };

    if ('requestIdleCallback' in window) {
      idleId = (window as any).requestIdleCallback(triggerSplash, { timeout: 2200 });
    } else {
      timeoutId = setTimeout(triggerSplash, 1);
    }

    return () => {
      cancelled = true;
      if (idleId !== null && 'cancelIdleCallback' in window) {
        (window as any).cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    };
  }, [isNavbarReady, prefersReducedMotion]);

  const handleSplashComplete = () => {
    try {
      sessionStorage.setItem('virtai:overview-splash-seen', '1');
    } catch {
      // ignore
    } finally {
      setShowSplash(false);
    }
  };

  return { showSplash, handleSplashComplete };
}

export default useSplashSession;

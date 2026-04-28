import { lazy, startTransition, Suspense, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';

import { selectIsAuthenticated, useAuthStore } from '@/features/auth/store/authStore';
import HeroSection from '@/widgets/Overview/HeroSection';

const Navbar = lazy(() => import('@/widgets/Overview/Navbar'));
const SplashScreen = lazy(() => import('@/widgets/Overview/SplashScreen'));
const CircuitBoardBackground = lazy(() => import('@/widgets/Overview/CircuitBoardBackground'));
const DemoPreview = lazy(() => import('@/widgets/Overview/DemoPreview'));
const FeaturesSection = lazy(() => import('@/widgets/Overview/FeaturesSection'));
const Footer = lazy(() => import('@/widgets/Overview/Footer'));
const HowItWorks = lazy(() => import('@/widgets/Overview/HowItWorks'));
const TechStackSection = lazy(() => import('@/widgets/Overview/TechStackSection'));

const INITIAL_PHASES = {
  navbar: false,
  features: false,
  howItWorks: false,
  techStack: false,
  demo: false,
  footer: false,
};

const PHASE2_SEQUENCE = ['navbar', 'features', 'howItWorks', 'techStack', 'demo', 'footer'];

function getReducedMotionPreference() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isLowPerformanceDevice() {
  if (typeof window === 'undefined') {
    return true;
  }

  const connection = navigator.connection;
  const saveDataEnabled = !!connection?.saveData;
  const slowNetwork = ['slow-2g', '2g'].includes(connection?.effectiveType || '');
  const lowMemoryDevice = typeof navigator.deviceMemory === 'number' && navigator.deviceMemory <= 4;
  const lowCpuDevice =
    typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency <= 4;
  const desktopViewport =
    typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 1024px)').matches;

  return saveDataEnabled || slowNetwork || lowMemoryDevice || lowCpuDevice || !desktopViewport;
}

function scheduleIdleTask(task, { delay = 0, timeout = 1500 } = {}) {
  let idleId = null;
  let timeoutId = null;
  let cancelled = false;

  const runTask = () => {
    if (cancelled) {
      return;
    }

    task();
  };

  const queueTask = () => {
    if ('requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(runTask, { timeout });
      return;
    }

    timeoutId = window.setTimeout(runTask, 1);
  };

  if (delay > 0) {
    timeoutId = window.setTimeout(queueTask, delay);
  } else {
    queueTask();
  }

  return () => {
    cancelled = true;

    if (idleId !== null && 'cancelIdleCallback' in window) {
      window.cancelIdleCallback(idleId);
    }

    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  };
}

function DeferredSection({ shouldRender, fallback = null, children }) {
  if (!shouldRender) {
    return null;
  }

  return <Suspense fallback={fallback}>{children}</Suspense>;
}

export default function OverviewPage() {
  const [phase2, setPhase2] = useState(INITIAL_PHASES);
  const [showSplash, setShowSplash] = useState(false);
  const [showAmbient, setShowAmbient] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(getReducedMotionPreference);
  const isAuthenticated = useAuthStore(selectIsAuthenticated);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setPrefersReducedMotion(media.matches);

    updatePreference();
    media.addEventListener('change', updatePreference);

    return () => media.removeEventListener('change', updatePreference);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let firstFrameId = null;
    let secondFrameId = null;
    const cleanups = [];

    const revealStep = (step) => {
      startTransition(() => {
        setPhase2((currentPhase) => {
          if (currentPhase[step]) {
            return currentPhase;
          }

          return { ...currentPhase, [step]: true };
        });
      });
    };

    const queueStep = (index) => {
      if (cancelled || index >= PHASE2_SEQUENCE.length) {
        return;
      }

      const cleanup = scheduleIdleTask(
        () => {
          if (cancelled) {
            return;
          }

          revealStep(PHASE2_SEQUENCE[index]);
          queueStep(index + 1);
        },
        {
          delay: 0,
          timeout: index === 0 ? 1000 : 1600,
        }
      );

      cleanups.push(cleanup);
    };

    firstFrameId = window.requestAnimationFrame(() => {
      secondFrameId = window.requestAnimationFrame(() => {
        queueStep(0);
      });
    });

    return () => {
      cancelled = true;

      if (firstFrameId !== null) {
        cancelAnimationFrame(firstFrameId);
      }
      if (secondFrameId !== null) {
        cancelAnimationFrame(secondFrameId);
      }

      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  useEffect(() => {
    if (!phase2.navbar || prefersReducedMotion) {
      return;
    }

    const alreadySeenSplash = sessionStorage.getItem('virtai:overview-splash-seen') === '1';
    if (alreadySeenSplash) {
      return;
    }

    return scheduleIdleTask(() => setShowSplash(true), { delay: 0, timeout: 2200 });
  }, [phase2.navbar, prefersReducedMotion]);

  useEffect(() => {
    if (!phase2.footer || prefersReducedMotion || isLowPerformanceDevice()) {
      setShowAmbient(false);
      return;
    }

    return scheduleIdleTask(() => setShowAmbient(true), { delay: 0, timeout: 2600 });
  }, [phase2.footer, prefersReducedMotion]);

  const primaryCta = isAuthenticated
    ? { label: 'Go to Classroom', to: '/classroom' }
    : { label: 'Log In / Sign Up', to: '/auth' };

  const handleSplashComplete = () => {
    sessionStorage.setItem('virtai:overview-splash-seen', '1');
    setShowSplash(false);
  };

  return (
    <>
      <Helmet>
        <title>VirtAI – AI Teaching Assistant</title>
        <meta
          name="description"
          content="VirtAI is a real-time AI teaching assistant powered by speech recognition, large language models, and a 3D avatar."
        />
      </Helmet>

      {showSplash && (
        <Suspense fallback={null}>
          <SplashScreen onComplete={handleSplashComplete} />
        </Suspense>
      )}

      <div className="relative min-h-screen bg-dark text-offwhite">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-100 focus:rounded-md focus:bg-gold focus:px-4 focus:py-2 focus:text-dark focus:outline-none"
        >
          Skip to content
        </a>

        <DeferredSection shouldRender={showAmbient}>
          <CircuitBoardBackground />
        </DeferredSection>

        <DeferredSection shouldRender={phase2.navbar}>
          <Navbar ctaLabel={primaryCta.label} ctaTo={primaryCta.to} />
        </DeferredSection>

        <main id="main-content">
          <HeroSection ctaLabel={primaryCta.label} ctaTo={primaryCta.to} />

          <DeferredSection shouldRender={phase2.features}>
            <FeaturesSection />
          </DeferredSection>

          <DeferredSection shouldRender={phase2.howItWorks}>
            <HowItWorks />
          </DeferredSection>

          <DeferredSection shouldRender={phase2.techStack}>
            <TechStackSection />
          </DeferredSection>

          <DeferredSection shouldRender={phase2.demo}>
            <DemoPreview />
          </DeferredSection>
        </main>

        <DeferredSection shouldRender={phase2.footer}>
          <Footer />
        </DeferredSection>
      </div>
    </>
  );
}

import { lazy, Suspense, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';

import HeroSection from '@/widgets/Overview/HeroSection';
import Navbar from '@/widgets/Overview/Navbar';
import SplashScreen from '@/widgets/Overview/SplashScreen';

const CircuitBoardBackground = lazy(() => import('@/widgets/Overview/CircuitBoardBackground'));
const DemoPreview = lazy(() => import('@/widgets/Overview/DemoPreview'));
const FeaturesSection = lazy(() => import('@/widgets/Overview/FeaturesSection'));
const Footer = lazy(() => import('@/widgets/Overview/Footer'));
const HowItWorks = lazy(() => import('@/widgets/Overview/HowItWorks'));
const TechStackSection = lazy(() => import('@/widgets/Overview/TechStackSection'));

export default function OverviewPage() {
  const [showSplash, setShowSplash] = useState(false);
  const [showAmbient, setShowAmbient] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const navigate = useNavigate();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const alreadySeenSplash = sessionStorage.getItem('virtai:overview-splash-seen') === '1';
    setShowSplash(!prefersReducedMotion && !alreadySeenSplash);
  }, [prefersReducedMotion]);

  useEffect(() => {
    if (prefersReducedMotion) {
      return;
    }

    const connection = navigator.connection;
    const saveDataEnabled = !!connection?.saveData;
    const lowMemoryDevice =
      typeof navigator.deviceMemory === 'number' && navigator.deviceMemory <= 4;
    const desktopViewport = window.matchMedia('(min-width: 1024px)').matches;

    if (saveDataEnabled || lowMemoryDevice || !desktopViewport) {
      return;
    }

    let timeoutId = null;
    let idleId = null;
    let cancelled = false;

    const enableAmbient = () => {
      if (!cancelled) {
        setShowAmbient(true);
      }
    };

    if ('requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(enableAmbient, { timeout: 2500 });
    } else {
      timeoutId = window.setTimeout(enableAmbient, 1200);
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
  }, [prefersReducedMotion]);

  const handleCTA = () => navigate('/auth');
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

      {showSplash && <SplashScreen onComplete={handleSplashComplete} />}

      <div className="relative min-h-screen bg-dark text-offwhite">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-100 focus:rounded-md focus:bg-gold focus:px-4 focus:py-2 focus:text-dark focus:outline-none"
        >
          Skip to content
        </a>

        {showAmbient && (
          <Suspense fallback={null}>
            <CircuitBoardBackground />
          </Suspense>
        )}

        <Navbar />

        <main id="main-content">
          <HeroSection onCTA={handleCTA} />
          
          <Suspense fallback={<div className="min-h-[50vh]" />}>
            <FeaturesSection />
            <HowItWorks />
            <TechStackSection />
            <DemoPreview />
          </Suspense>
        </main>
        
        <Suspense fallback={null}>
          <Footer />
        </Suspense>
      </div>
    </>
  );
}

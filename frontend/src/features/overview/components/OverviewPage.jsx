import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';

import CircuitBoardBackground from '@/widgets/Overview/CircuitBoardBackground';
import DemoPreview from '@/widgets/Overview/DemoPreview';
import FeaturesSection from '@/widgets/Overview/FeaturesSection';
import Footer from '@/widgets/Overview/Footer';
import HeroSection from '@/widgets/Overview/HeroSection';
import HowItWorks from '@/widgets/Overview/HowItWorks';
import Navbar from '@/widgets/Overview/Navbar';
import SplashScreen from '@/widgets/Overview/SplashScreen';
import TechStackSection from '@/widgets/Overview/TechStackSection';

export default function OverviewPage() {
  const [splashDone, setSplashDone] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const handleCTA = () => navigate('/auth');

  return (
    <>
      <Helmet>
        <title>VirtAI – AI Teaching Assistant</title>
        <meta
          name="description"
          content="VirtAI is a real-time AI teaching assistant powered by speech recognition, large language models, and a 3D avatar."
        />
      </Helmet>

      {!splashDone && <SplashScreen onComplete={() => setSplashDone(true)} />}

      <div
        className="relative min-h-screen bg-dark text-offwhite"
        style={{
          opacity: splashDone ? 1 : 0,
          pointerEvents: splashDone ? 'auto' : 'none',
          transition: 'opacity 0.6s ease',
        }}
      >
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-100 focus:rounded-md focus:bg-gold focus:px-4 focus:py-2 focus:text-dark focus:outline-none"
        >
          Skip to content
        </a>
        <CircuitBoardBackground />
        <Navbar />

        <main id="main-content">
          <HeroSection onCTA={handleCTA} />
          <FeaturesSection />
          <HowItWorks />
          <TechStackSection />
          <DemoPreview />
        </main>
        <Footer />
      </div>
    </>
  );
}

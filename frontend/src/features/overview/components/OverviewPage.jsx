import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';

import CircuitLines from '@/shared/ui/CircuitLines';
import DemoPreview from './DemoPreview';
import FeaturesSection from './FeaturesSection';
import Footer from './Footer';
import HeroSection from './HeroSection';
import HowItWorks from './HowItWorks';
import SplashScreen from './SplashScreen';
import StatsSection from './StatsSection';
import TechStackSection from './TechStackSection';

export default function OverviewPage() {
  const [splashDone, setSplashDone] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const handleCTA = () => navigate('/classroom');

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
        <CircuitLines />

        <HeroSection onCTA={handleCTA} />
        <FeaturesSection />
        <HowItWorks />
        <TechStackSection />
        <StatsSection />
        <DemoPreview />
        <Footer />
      </div>
    </>
  );
}

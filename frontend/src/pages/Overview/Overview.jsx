import { Link } from 'react-router-dom';
import FeaturesSection from './components/FeaturesSection';
import Footer from './components/Footer/Footer';
import { LiquidButton } from '../../components/buttons/liquid';
import './Overview.css';

function Overview() {
  return (
    <div className="overview">
      {/* ── Hero ── */}
      <section className="hero" aria-label="Introduction">
        <div className="hero__left">

          {/* Headline */}
          <h1 className="hero__headline">
            Real-time AI Avatar
            <span className="hero__headline-accent"> for Learning</span>
          </h1>

          {/* Subtitle */}
          <p className="hero__subtitle">
            Streaming chat over WebSocket, optional document-grounded RAG,
            ASR&nbsp;in and TTS&nbsp;out — with a live avatar that reacts to
            every stage of the pipeline.
          </p>

          {/* CTAs */}
          <div className="hero__ctas">
            <LiquidButton as={Link} to="/setup" size="md">
              Get Started
            </LiquidButton>
          </div>

        </div>

        {/* Hero image */}
        <div className="hero__right">
          <div className="hero__frame">
            <div className="hero__frame-glow" aria-hidden="true" />
            <img
              src="/assets/image.webp"
              alt="VirtAI — AI Avatar interface"
              className="hero__image"
              width={520}
              height={520}
              loading="eager"
            />
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <FeaturesSection />

      {/* ── Footer ── */}
      <Footer />
    </div>
  );
}

export default Overview;
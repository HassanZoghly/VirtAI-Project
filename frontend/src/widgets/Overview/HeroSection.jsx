import AnimatedShinyButton from '@/shared/ui/AnimatedShinyButton';
import { motion } from 'motion/react';

export default function HeroSection({ onCTA }) {
  return (
    <section className="relative flex min-h-[90vh] flex-col items-center justify-center overflow-hidden px-6 text-center">
      {/* radial gradient backdrop */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(109,0,26,0.15)_0%,transparent_70%)]" />

      <motion.h1
        className="relative z-10 mt-16 max-w-3xl text-5xl font-extrabold leading-tight text-offwhite sm:text-6xl lg:text-7xl"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
      >
        Your AI Teaching <span className="text-crimson">Assistant</span>
      </motion.h1>

      <motion.p
        className="relative z-10 mt-6 max-w-xl text-lg text-offwhite/60"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.25 }}
      >
        A real-time, voice-driven 3D avatar that answers your questions with accurate lip-sync and
        context-aware intelligence.
      </motion.p>

      <motion.div
        className="relative z-10 mt-10"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, delay: 0.5 }}
      >
        <AnimatedShinyButton onClick={onCTA}>Get Started</AnimatedShinyButton>
      </motion.div>

      {/* hero image */}
      <motion.img
        src="/assets/images/image.webp"
        alt="VirtAI classroom preview"
        className="relative z-10 mt-16 w-full max-w-4xl rounded-2xl border border-white/10 shadow-2xl"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 0.7 }}
      />
    </section>
  );
}

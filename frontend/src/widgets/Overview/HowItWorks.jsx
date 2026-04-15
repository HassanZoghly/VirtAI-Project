import { useEffect, useRef, useState } from 'react';
import { howItWorks as steps } from '@/features/overview';
import { motion } from 'motion/react';

export default function HowItWorks() {
  const [activeIndex, setActiveIndex] = useState(0);
  const markersRef = useRef([]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (a, b) =>
              b.intersectionRatio - a.intersectionRatio ||
              a.boundingClientRect.top - b.boundingClientRect.top
          );

        if (!visible[0]) return;
        const nextIndex = Number(visible[0].target.getAttribute('data-step-index'));
        if (!Number.isNaN(nextIndex)) setActiveIndex(nextIndex);
      },
      {
        threshold: [0.25, 0.5, 0.75],
        rootMargin: '-22% 0px -42% 0px',
      }
    );

    markersRef.current.forEach((marker) => marker && observer.observe(marker));
    return () => observer.disconnect();
  }, []);

  const activeStep = steps[activeIndex] ?? steps[0];

  return (
    <section id="how-it-works" className="relative mx-auto max-w-6xl px-6 py-18">
      <header className="sticky top-18 z-30 mb-8 rounded-2xl border border-white/10 bg-dark/75 px-6 py-5 backdrop-blur-md">
        <motion.h2
          className="text-3xl font-bold tracking-tight text-offwhite sm:text-4xl"
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.6 }}
          transition={{ duration: 0.35 }}
        >
          How It Works
        </motion.h2>
        <p className="mt-2 text-sm font-medium tracking-wider text-gold/90 sm:text-base">
          VOICE → ASR → RAG → LLM → TTS → AVATAR
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,290px)_1fr]">
        <aside className="relative lg:sticky lg:top-44 lg:h-fit">
          <div className="pointer-events-none absolute left-5 top-1.5 bottom-1.5 w-px bg-linear-to-b from-crimson/50 via-gold/40 to-crimson/20" />
          <ol className="space-y-2" aria-label="How it works steps">
            {steps.map((step, index) => {
              const isActive = index === activeIndex;
              return (
                <li key={step.step} aria-current={isActive ? 'step' : undefined}>
                  <motion.div
                    className={`group relative flex items-start gap-3 rounded-xl border px-3 py-3 transition-colors duration-200 ${
                      isActive
                        ? 'border-crimson/55 bg-crimson/10 text-offwhite shadow-[0_0_20px_rgba(109,0,26,0.35)]'
                        : 'border-white/10 bg-dark/45 text-offwhite/65'
                    }`}
                    animate={{ scale: isActive ? 1.02 : 1, opacity: isActive ? 1 : 0.78 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                  >
                    <span
                      className={`relative z-10 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${
                        isActive
                          ? 'border-crimson/70 bg-crimson/20 text-crimson'
                          : 'border-white/20 bg-white/5 text-offwhite/60'
                      }`}
                    >
                      {step.step}
                    </span>
                    <span className="text-sm font-medium tracking-wide">{step.label}</span>
                  </motion.div>
                </li>
              );
            })}
          </ol>
        </aside>

        <div className="relative">
          <div className="sticky top-44 z-20 rounded-2xl border border-white/10 bg-dark/72 p-6 shadow-[0_18px_54px_rgba(0,0,0,0.35)] backdrop-blur-sm">
            <motion.article
              key={activeStep.step}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              aria-live="polite"
            >
              <p className="text-xs font-semibold tracking-[0.22em] text-gold/85">
                STEP {activeStep.step}
              </p>
              <h3 className="mt-2 text-2xl font-semibold text-offwhite">{activeStep.label}</h3>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-offwhite/78">
                {activeStep.description}
              </p>
            </motion.article>
          </div>

          <div className="mt-6 space-y-5">
            {steps.map((step, index) => (
              <article
                key={`marker-${step.step}`}
                ref={(node) => {
                  markersRef.current[index] = node;
                }}
                data-step-index={index}
                className="rounded-xl border border-white/8 bg-dark/35 px-4 py-7"
              >
                <p className="text-xs tracking-[0.18em] text-offwhite/50">SCROLL CUE {step.step}</p>
                <p className="mt-1 text-sm text-offwhite/68">{step.label}</p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

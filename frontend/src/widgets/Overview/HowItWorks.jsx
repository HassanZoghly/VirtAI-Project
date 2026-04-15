import { useEffect, useMemo, useRef, useState } from 'react';
import { howItWorks as steps } from '@/features/overview';
import { motion, useReducedMotion } from 'motion/react';

const PIPELINE_STATES = ['receiving', 'processing', 'output'];
const STATE_LABEL = {
  idle: 'Idle',
  receiving: 'Receiving input',
  processing: 'Processing',
  output: 'Output ready',
  completed: 'Completed',
};
const PIPELINE_SEQUENCE = 'VOICE → ASR → RAG → LLM → TTS → AVATAR';
export const PIPELINE_PHASE_DURATION_MS = 900;

function getStagePhase(index, activeIndex, phaseIndex) {
  if (index < activeIndex) {
    return 'completed';
  }
  if (index > activeIndex) {
    return 'idle';
  }
  return PIPELINE_STATES[phaseIndex] ?? 'processing';
}

function getCardClasses(phase, isCurrent) {
  if (phase === 'completed') {
    return 'border-gold/35 bg-gold/8 text-offwhite/85';
  }
  if (isCurrent) {
    return 'border-crimson/55 bg-crimson/12 text-offwhite shadow-[0_0_20px_rgba(109,0,26,0.3)]';
  }
  return 'border-white/10 bg-dark/55 text-offwhite/66';
}

function getStageSignal(step, phase) {
  if (phase === 'completed' || phase === 'output') {
    return `OUT: ${step.output}`;
  }
  if (phase === 'processing') {
    return `PROC: ${step.processing}`;
  }
  if (phase === 'receiving') {
    return `IN: ${step.input}`;
  }
  return 'Waiting for upstream handoff';
}

export default function HowItWorks() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const markersRef = useRef([]);
  const activeRef = useRef(0);
  const phaseRef = useRef(0);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    activeRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    phaseRef.current = phaseIndex;
  }, [phaseIndex]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (a, b) =>
              b.intersectionRatio - a.intersectionRatio ||
              a.boundingClientRect.top - b.boundingClientRect.top
          );

        if (!visible[0]) {
          return;
        }

        const nextIndex = Number(visible[0].target.getAttribute('data-step-index'));
        if (!Number.isNaN(nextIndex)) {
          setActiveIndex(nextIndex);
          setPhaseIndex(0);
        }
      },
      {
        threshold: [0.5, 0.7, 0.9],
        rootMargin: '-22% 0px -32% 0px',
      }
    );

    markersRef.current.forEach((marker) => marker && observer.observe(marker));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !isPlaying) {
      return;
    }

    const tickDuration = prefersReducedMotion
      ? PIPELINE_PHASE_DURATION_MS * 1.35
      : PIPELINE_PHASE_DURATION_MS;

    const intervalId = window.setInterval(() => {
      const currentPhase = phaseRef.current;
      const currentStage = activeRef.current;

      if (currentPhase < PIPELINE_STATES.length - 1) {
        setPhaseIndex(currentPhase + 1);
        return;
      }

      if (currentStage < steps.length - 1) {
        setActiveIndex(currentStage + 1);
        setPhaseIndex(0);
        return;
      }

      setIsPlaying(false);
    }, tickDuration);

    return () => window.clearInterval(intervalId);
  }, [isPlaying, prefersReducedMotion]);

  const activePhase = useMemo(
    () => getStagePhase(activeIndex, activeIndex, phaseIndex),
    [activeIndex, phaseIndex]
  );
  const activeStep = steps[activeIndex] ?? steps[0];
  const nextStep = steps[activeIndex + 1];

  return (
    <section id="how-it-works" className="relative mx-auto max-w-5xl px-6 py-16 lg:py-18">
      <header className="sticky top-18 z-30 mb-4 rounded-2xl border border-white/10 bg-dark/82 px-5 py-4 shadow-[0_18px_42px_rgba(0,0,0,0.26)] backdrop-blur-md">
        <motion.h2
          className="text-3xl font-bold tracking-tight text-offwhite sm:text-4xl"
          initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
          whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.6 }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.35 }}
        >
          How It Works
        </motion.h2>
        <p className="mt-1 text-xs font-semibold tracking-[0.18em] text-gold/90 sm:text-sm">
          {PIPELINE_SEQUENCE}
        </p>

        <div
          className="mt-3 flex flex-wrap gap-2"
          role="group"
          aria-label="Pipeline playback controls"
        >
          <button
            type="button"
            onClick={() => setIsPlaying(true)}
            className="rounded-md border border-gold/45 bg-gold/10 px-3 py-1.5 text-xs font-semibold text-gold transition-colors hover:bg-gold/16 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-dark"
          >
            Play
          </button>
          <button
            type="button"
            onClick={() => setIsPlaying(false)}
            className="rounded-md border border-white/20 px-3 py-1.5 text-xs font-semibold text-offwhite/82 transition-colors hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offwhite/70 focus-visible:ring-offset-2 focus-visible:ring-offset-dark"
          >
            Pause
          </button>
          <button
            type="button"
            onClick={() => {
              setIsPlaying(false);
              setActiveIndex(0);
              setPhaseIndex(0);
            }}
            className="rounded-md border border-white/20 px-3 py-1.5 text-xs font-semibold text-offwhite/82 transition-colors hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offwhite/70 focus-visible:ring-offset-2 focus-visible:ring-offset-dark"
          >
            Replay
          </button>
        </div>

        <p className="mt-3 text-sm text-offwhite/78">
          <span className="font-semibold text-offwhite">Now:</span> {activeStep.label} —{' '}
          {STATE_LABEL[activePhase]}
        </p>
        <p className="sr-only" aria-live="polite">
          {`Current stage ${activeStep.label}. State ${STATE_LABEL[activePhase]}.`}
        </p>
      </header>

      <motion.article
        key={`${activeStep.step}-${activePhase}`}
        className="mb-3 rounded-xl border border-white/10 bg-dark/72 px-4 py-4"
        initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: prefersReducedMotion ? 0 : 0.2, ease: 'easeOut' }}
      >
        <p className="text-[11px] font-semibold tracking-[0.16em] text-gold/86">
          STEP {activeStep.step}
        </p>
        <h3 className="mt-1 text-base font-semibold text-offwhite sm:text-lg">
          {activeStep.label}
        </h3>
        <p className="mt-1 text-sm text-offwhite/76">{activeStep.description}</p>
        <div className="mt-3 space-y-1 text-xs text-offwhite/74">
          <p>
            <span className="font-semibold text-offwhite/86">IN:</span> {activeStep.input}
          </p>
          <p>
            <span className="font-semibold text-offwhite/86">PROC:</span> {activeStep.processing}
          </p>
          <p>
            <span className="font-semibold text-gold/90">OUT:</span> {activeStep.output}
          </p>
          <p>
            <span className="font-semibold text-crimson/88">HANDOFF:</span>{' '}
            {nextStep ? `Passing output to ${nextStep.label}` : 'Final delivery complete.'}
          </p>
        </div>
      </motion.article>

      <ol className="space-y-2" aria-label="How it works pipeline stages">
        {steps.map((step, index) => {
          const stagePhase = getStagePhase(index, activeIndex, phaseIndex);
          const isCurrent = index === activeIndex;
          const isFlowing = isCurrent && stagePhase === 'output';
          const connectorFilled = index < activeIndex || isFlowing;

          return (
            <li
              key={step.step}
              ref={(node) => {
                markersRef.current[index] = node;
              }}
              data-step-index={index}
              data-stage-state={
                index < activeIndex ? 'completed' : isCurrent ? 'active' : 'upcoming'
              }
              data-stage-phase={stagePhase}
              aria-current={isCurrent ? 'step' : undefined}
              className="relative pl-9"
            >
              <span
                className={`absolute left-0 top-6 flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold ${
                  isCurrent
                    ? 'border-crimson/70 bg-crimson/22 text-crimson'
                    : index < activeIndex
                      ? 'border-gold/60 bg-gold/14 text-gold'
                      : 'border-white/20 bg-white/6 text-offwhite/60'
                }`}
              >
                {step.step}
              </span>

              {index < steps.length - 1 && (
                <span className="pointer-events-none absolute left-3 top-12 h-6 w-px bg-white/16">
                  <motion.span
                    className={`absolute inset-x-0 top-0 w-px ${
                      connectorFilled ? 'bg-gold' : 'bg-transparent'
                    }`}
                    animate={
                      prefersReducedMotion ? undefined : { height: connectorFilled ? '100%' : '0%' }
                    }
                    style={
                      prefersReducedMotion ? { height: connectorFilled ? '100%' : '0%' } : undefined
                    }
                    transition={{ duration: prefersReducedMotion ? 0 : 0.35, ease: 'easeInOut' }}
                  />
                  {isFlowing && !prefersReducedMotion ? (
                    <motion.span
                      className="absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-gold shadow-[0_0_10px_rgba(230,196,122,0.65)]"
                      initial={{ y: 0, opacity: 0 }}
                      animate={{ y: 18, opacity: [0, 1, 0.6] }}
                      transition={{ duration: 0.45, ease: 'easeInOut' }}
                    />
                  ) : null}
                </span>
              )}

              <motion.article
                className={`rounded-xl border px-4 py-3 transition-colors duration-200 ${getCardClasses(
                  stagePhase,
                  isCurrent
                )}`}
                initial={prefersReducedMotion ? false : { opacity: 0.8, y: 6 }}
                whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                animate={
                  prefersReducedMotion ? undefined : isCurrent ? { scale: 1.01 } : { scale: 1 }
                }
                transition={{ duration: prefersReducedMotion ? 0 : 0.2, ease: 'easeOut' }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold tracking-wide text-offwhite">
                    {step.label}
                  </h3>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                      stagePhase === 'completed'
                        ? 'border-gold/55 bg-gold/12 text-gold'
                        : isCurrent
                          ? 'border-crimson/45 bg-crimson/18 text-crimson'
                          : 'border-white/18 bg-white/4 text-offwhite/62'
                    }`}
                  >
                    {STATE_LABEL[stagePhase]}
                  </span>
                </div>

                <p className="mt-1 text-sm leading-relaxed text-offwhite/78">{step.description}</p>
                <p className="mt-2 text-xs text-offwhite/74">{getStageSignal(step, stagePhase)}</p>
              </motion.article>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

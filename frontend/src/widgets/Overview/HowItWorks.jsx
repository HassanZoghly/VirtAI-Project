import steps from '@/features/overview/data/howItWorks';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useRef, useState } from 'react';
import { FiCheck } from 'react-icons/fi';
import {
  PiBrainFill,
  PiMagnifyingGlassFill,
  PiMicrophoneFill,
  PiSpeakerHighFill,
  PiUserCircleFill,
  PiWaveformFill,
} from 'react-icons/pi';

/* ─── icon map ───────────────────────────────────────────────────────────── */

const STEP_ICONS = [
  PiMicrophoneFill,
  PiWaveformFill,
  PiMagnifyingGlassFill,
  PiBrainFill,
  PiSpeakerHighFill,
  PiUserCircleFill,
];

const PIPELINE_NODES = ['VOICE', 'ASR', 'RAG', 'LLM', 'TTS', 'AVATAR'];

/* ─── PipelineBadge ─────────────────────────────────────────────────────── */

function PipelineBadge({ activeIndex }) {
  return (
    <div className="mt-5 flex flex-wrap gap-1.5" role="list" aria-label="AI pipeline steps">
      {PIPELINE_NODES.map((node, i) => {
        const isActive = i === activeIndex;
        const isDone = i < activeIndex;
        return (
          <span
            key={node}
            role="listitem"
            className={[
              'flex items-center gap-1 rounded-full border px-2.5 py-0.5',
              'text-[10px] font-bold uppercase tracking-widest transition-all duration-300',
              isActive
                ? 'border-crimson/55 bg-crimson/16 text-offwhite'
                : isDone
                  ? 'border-gold/40 bg-gold/10 text-gold/90'
                  : 'border-white/10 bg-white/5 text-offwhite/38',
            ].join(' ')}
          >
            {isDone && <FiCheck className="h-2.5 w-2.5 shrink-0 text-gold" aria-hidden="true" />}
            {node}
            {i < PIPELINE_NODES.length - 1 && (
              <span
                className={`ml-1 text-[9px] ${isDone ? 'text-gold/60' : 'text-offwhite/20'}`}
                aria-hidden="true"
              >
                →
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

/* ─── step dimensions ───────────────────────────────────────────────────── */

const CIRCLE_SIZE = 44;

/* ─── TimelineStep ──────────────────────────────────────────────────────── */

function TimelineStep({ step, index, isActive, isDone, isLast, stepRef, reduced }) {
  const Icon = STEP_ICONS[index];

  return (
    <li
      ref={stepRef}
      data-step-index={index}
      aria-current={isActive ? 'step' : undefined}
      className="relative pl-16"
      style={{ paddingBottom: isLast ? 0 : '2rem' }}
    >
      {/* vertical connector */}
      {!isLast && (
        <div
          className="absolute w-px overflow-hidden"
          style={{
            left: CIRCLE_SIZE / 2 - 0.5,
            top: CIRCLE_SIZE + 4,
            height: `calc(100% - ${CIRCLE_SIZE + 4}px)`,
          }}
          aria-hidden="true"
        >
          <div className="absolute inset-0 bg-white/8" />
          <motion.div
            className="origin-top absolute inset-x-0 top-0 bg-gradient-to-b from-gold/60 to-gold/20"
            initial={{ scaleY: 0 }}
            animate={{ scaleY: isDone ? 1 : 0 }}
            transition={{ duration: reduced ? 0 : 0.6, ease: [0.4, 0, 0.2, 1] }}
            style={{ height: '100%' }}
          />
        </div>
      )}

      {/* circle */}
      <span
        className={[
          'absolute left-0 top-0 flex items-center justify-center rounded-full border',
          'text-sm font-bold transition-all duration-300',
          isActive
            ? 'border-crimson/55 bg-crimson/16 text-offwhite'
            : isDone
              ? 'border-gold/50 bg-gold/14 text-gold'
              : 'border-white/14 bg-white/6 text-offwhite/45',
        ].join(' ')}
        style={{ width: CIRCLE_SIZE, height: CIRCLE_SIZE }}
        aria-hidden="true"
      >
        {isDone ? <FiCheck className="h-4 w-4" /> : step.step}
      </span>

      {/* card */}
      <motion.div
        animate={reduced ? undefined : { scale: isActive ? 1.01 : 1 }}
        transition={{ duration: reduced ? 0 : 0.25, ease: 'easeOut' }}
        className={[
          'rounded-2xl border px-5 py-4 transition-colors duration-300',
          isActive
            ? 'border-crimson/45 bg-crimson/9'
            : isDone
              ? 'border-gold/25 bg-gold/[0.06]'
              : 'border-white/8 bg-white/[0.03]',
        ].join(' ')}
      >
        <div className="flex items-center gap-2.5">
          <Icon
            className={[
              'h-4 w-4 shrink-0 transition-colors duration-300',
              isActive ? 'text-crimson' : isDone ? 'text-gold/80' : 'text-offwhite/32',
            ].join(' ')}
            aria-hidden="true"
          />
          <h3
            className={`text-sm font-semibold transition-colors duration-300 ${
              isActive ? 'text-offwhite' : isDone ? 'text-offwhite/80' : 'text-offwhite/50'
            }`}
          >
            {step.label}
          </h3>
          {isActive && (
            <motion.span
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              className="rounded-full border border-crimson/45 bg-crimson/18 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-crimson"
            >
              Active
            </motion.span>
          )}
          {isDone && !isActive && (
            <span className="rounded-full border border-gold/35 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-gold/80">
              Done
            </span>
          )}
        </div>

        <p
          className={`mt-1.5 text-xs leading-relaxed transition-colors duration-300 ${
            isActive ? 'text-offwhite/72' : 'text-offwhite/38'
          }`}
        >
          {step.description}
        </p>

        <AnimatePresence>
          {isActive && (
            <motion.p
              initial={reduced ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={reduced ? undefined : { opacity: 0, height: 0 }}
              transition={{ duration: reduced ? 0 : 0.2 }}
              className="mt-2 overflow-hidden text-xs leading-relaxed font-mono text-gold/70"
            >
              OUT → {step.output}
            </motion.p>
          )}
        </AnimatePresence>
      </motion.div>
    </li>
  );
}

/* ─── main ───────────────────────────────────────────────────────────────── */

export default function HowItWorks() {
  const [activeIndex, setActiveIndex] = useState(0);

  const stepRefs = useRef([]);
  const reduced = useReducedMotion();

  const handleScroll = (e) => {
    const scroller = e.currentTarget;
    const containerTop = scroller.getBoundingClientRect().top;
    const targetY = scroller.clientHeight * 0.35; // 35% from the top
    let best = 0;
    let bestDist = Infinity;

    stepRefs.current.forEach((el, i) => {
      if (!el) {
        return;
      }
      const rect = el.getBoundingClientRect();
      const relTop = rect.top - containerTop;
      const dist = Math.abs(relTop - targetY);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });

    setActiveIndex((prev) => (prev !== best ? best : prev));
  };

  return (
    <section id="how-it-works" className="relative mx-auto max-w-6xl px-6 py-28">
      <motion.div
        className="mb-14 text-center"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.6 }}
      >
        <h2 className="text-4xl font-bold text-offwhite sm:text-5xl">
          How It <span className="text-gold">Works</span>
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-offwhite/70">
          Your voice travels through a six-stage AI pipeline, from speech recognition to a
          lip-synced 3D avatar delivering the answer.
        </p>
      </motion.div>

      {/* ── Isolated scroll container ── */}
      <div className="relative mx-auto flex max-w-5xl flex-col overflow-hidden lg:h-[600px] lg:flex-row">
        {/* radial glow */}
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_0%_50%,rgba(109,0,26,0.08)_0%,transparent_70%)]"
          aria-hidden="true"
        />

        {/* ══════════════════════════════════════
            LEFT PANEL — fixed content
        ══════════════════════════════════════ */}
        <div className="relative z-10 flex flex-col justify-center px-8 py-10 lg:w-[45%] lg:shrink-0 lg:py-14 lg:pl-12 lg:pr-8">
          <motion.div
            initial={reduced ? false : { opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.15 }}
          >
            <PipelineBadge activeIndex={activeIndex} />
          </motion.div>

          <motion.p
            className="mt-8 text-sm leading-relaxed text-offwhite/50"
            initial={reduced ? false : { opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            Scroll through the pipeline stages on the right to see how VirtAI processes your speech,
            retrieves relevant context, generates a response, and animates the 3D avatar in real
            time.
          </motion.p>

          {/* progress bar */}
          <div className="mt-10 hidden items-center gap-3 lg:flex" aria-hidden="true">
            <div className="h-px flex-1 overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="origin-left h-full bg-gradient-to-r from-crimson/70 to-gold/60"
                animate={{ scaleX: (activeIndex + 1) / steps.length }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
              />
            </div>
            <span className="text-[10px] tabular-nums text-offwhite/30">
              {activeIndex + 1} / {steps.length}
            </span>
          </div>
        </div>

        {/* ══════════════════════════════════════
            RIGHT PANEL — isolated scroll
        ══════════════════════════════════════ */}
        <div
          onScroll={handleScroll}
          className="how-it-works-scroll relative z-10 flex-1 overflow-y-auto px-5 py-10 max-h-[60vh] lg:max-h-none lg:py-0 lg:pl-8 lg:pr-12"
          aria-label="Pipeline steps timeline"
        >
          {/* top spacer */}
          <div className="hidden lg:block lg:h-[180px]" aria-hidden="true" />

          <ol className="relative" aria-label="AI pipeline stages">
            {steps.map((step, index) => (
              <TimelineStep
                key={step.step}
                step={step}
                index={index}
                isActive={index === activeIndex}
                isDone={index < activeIndex}
                isLast={index === steps.length - 1}
                stepRef={(el) => {
                  stepRefs.current[index] = el;
                }}
                reduced={reduced}
              />
            ))}
          </ol>

          {/* bottom spacer */}
          <div className="hidden lg:block lg:h-[250px]" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}

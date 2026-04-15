/**
 * HowItWorks — Scroll-driven split-panel section.
 *
 * Architecture:
 *   • An outer "scroll-track" wrapper is tall enough to create natural page
 *     scroll room (100vh + right-panel's scrollable content).
 *   • Inside it, a `position: sticky; top: 0; height: 100vh` container
 *     stays pinned while the user scrolls through the wrapper.
 *   • The right column's internal scroll is driven by the outer wrapper's
 *     scroll progress — no event hijacking, no body overflow hacks.
 *   • Active step is computed from the right column's scroll position.
 *
 * Result: page scroll pauses naturally at this section, the left panel
 * stays fixed, the right panel scrolls, and then page scroll resumes.
 */

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { howItWorks as steps } from '@/features/overview';
import {
  PiMicrophoneFill,
  PiWaveformFill,
  PiMagnifyingGlassFill,
  PiBrainFill,
  PiSpeakerHighFill,
  PiUserCircleFill,
} from 'react-icons/pi';
import { FiCheck } from 'react-icons/fi';

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
              'text-[10px] font-bold tracking-widest uppercase transition-all duration-300',
              isActive
                ? 'border-crimson/60 bg-crimson/20 text-offwhite shadow-[0_0_14px_rgba(109,0,26,0.45)]'
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
            className="absolute inset-x-0 top-0 bg-gradient-to-b from-gold/60 to-gold/20 origin-top"
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
            ? 'border-crimson/60 bg-crimson/20 text-offwhite shadow-[0_0_16px_rgba(109,0,26,0.35)]'
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
            ? 'border-crimson/50 bg-crimson/10 shadow-[0_0_28px_rgba(109,0,26,0.22)]'
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
            className={`text-sm font-semibold transition-colors duration-300 ${isActive ? 'text-offwhite' : isDone ? 'text-offwhite/80' : 'text-offwhite/50'
              }`}
          >
            {step.label}
          </h3>
          {isActive && (
            <motion.span
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              className="rounded-full border border-crimson/45 bg-crimson/18 px-2 py-0.5
                         text-[10px] font-semibold uppercase tracking-widest text-crimson"
            >
              Active
            </motion.span>
          )}
          {isDone && !isActive && (
            <span
              className="rounded-full border border-gold/35 bg-gold/10 px-2 py-0.5
                         text-[10px] font-semibold uppercase tracking-widest text-gold/80"
            >
              Done
            </span>
          )}
        </div>

        <p
          className={`mt-1.5 text-xs leading-relaxed transition-colors duration-300 ${isActive ? 'text-offwhite/72' : 'text-offwhite/38'
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
              className="mt-2 text-[11px] font-mono text-gold/70 overflow-hidden"
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

/**
 * How it works:
 *
 * 1. The outer `<section>` (the "scroll track") has a calculated height:
 *        100vh  (the visible pinned panel)
 *      + the right column's full scroll height
 *
 *    This creates *real page scroll room* so the browser has something
 *    to scroll through while the panel stays pinned.
 *
 * 2. Inside that tall section, a `position: sticky; top: 0; height: 100vh`
 *    div pins the two-column layout to the screen.
 *
 * 3. On every animation frame we compute how far the user has scrolled
 *    through the section wrapper (0 → 1 progress). We map that progress
 *    to set `scrollTop` on the right column's hidden-overflow container.
 *
 * 4. Active step = whichever step card is closest to the 35% mark
 *    inside the right-column viewport.
 *
 * Zero body-overflow hacks. Zero wheel/touch hijacking. Pure CSS sticky.
 */

export default function HowItWorks() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [trackHeight, setTrackHeight] = useState('100vh');

  const trackRef = useRef(null);  // tall scroll-track wrapper
  const stickyRef = useRef(null);  // the 100vh pinned panel
  const scrollerRef = useRef(null);  // the right column (overflow-hidden — we drive scrollTop)
  const innerRef = useRef(null);  // the actual content inside the scroller
  const stepRefs = useRef([]);
  const rafId = useRef(null);
  const reduced = useReducedMotion();

  /* ── measure the right column's scrollable height and set track height ── */
  const lastScrollableRef = useRef(-1);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollTop = 0; // always start at the beginning

    const measure = () => {
      if (!scroller) return;
      const scrollable = Math.max(scroller.scrollHeight - scroller.clientHeight, 0);

      // Debounce minor height changes (like the active card expanding/collapsing)
      // to prevent the browser's native smooth-scrolling from aborting mid-scroll due to layout shifts.
      if (lastScrollableRef.current === -1 || Math.abs(scrollable - lastScrollableRef.current) > 100) {
        lastScrollableRef.current = scrollable;
        setTrackHeight(`calc(100vh + ${scrollable}px)`);
      }
    };

    // Wait a frame for layout to settle before first measurement
    requestAnimationFrame(() => {
      measure();
      // Schedule a second measurement after a short delay to catch
      // any post-render layout shifts (e.g. fonts loading, images)
      setTimeout(measure, 200);
    });

    // re-measure on resize
    const ro = new ResizeObserver(measure);
    if (scrollerRef.current) ro.observe(scrollerRef.current);
    if (innerRef.current) ro.observe(innerRef.current);

    return () => ro.disconnect();
  }, []);

  /* ── on page scroll: map wrapper progress → right column scrollTop ── */

  useEffect(() => {
    const onScroll = () => {
      if (rafId.current) {cancelAnimationFrame(rafId.current);}
      rafId.current = requestAnimationFrame(() => {
        const track = trackRef.current;
        const scroller = scrollerRef.current;
        if (!track || !scroller) {return;}

        const trackRect = track.getBoundingClientRect();
        const scrollable = scroller.scrollHeight - scroller.clientHeight;

        if (scrollable <= 0) {return;}

        // How far have we scrolled into the track wrapper?
        // When top of track = top of viewport → progress = 0
        // When bottom of track = bottom of viewport → progress = 1
        const trackScrollableHeight = track.offsetHeight - window.innerHeight;
        const progress = Math.max(0, Math.min(1, -trackRect.top / trackScrollableHeight));

        // Drive right column
        scroller.scrollTop = progress * scrollable;

        // Determine active step from right column's scroll position
        const containerTop = scroller.getBoundingClientRect().top;
        const targetY = scroller.clientHeight * 0.35;
        let best = 0;
        let bestDist = Infinity;

        stepRefs.current.forEach((el, i) => {
          if (!el) {return;}
          const rect = el.getBoundingClientRect();
          const relTop = rect.top - containerTop;
          const dist = Math.abs(relTop - targetY);
          if (dist < bestDist) {
            bestDist = dist;
            best = i;
          }
        });

        setActiveIndex((prev) => (prev !== best ? best : prev));
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll(); // initial

    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafId.current) {cancelAnimationFrame(rafId.current);}
    };
  }, []);

  /* ─── render ─── */

  return (
    <section
      id="how-it-works"
      ref={trackRef}
      /* This is the tall "scroll track". Its extra height creates natural
         page scroll room proportional to the right column's content.   */
      style={{ height: trackHeight }}
      className="relative"
      aria-label="How It Works"
    >
      {/* ── Pinned container — stays on screen while scrolling through track ── */}
      <div
        ref={stickyRef}
        className="sticky top-0 flex h-screen max-h-screen overflow-hidden"
      >
        {/* radial glow */}
        <div
          className="pointer-events-none absolute inset-0
                     bg-[radial-gradient(ellipse_80%_60%_at_0%_50%,rgba(109,0,26,0.08)_0%,transparent_70%)]"
          aria-hidden="true"
        />

        <div className="relative z-10 mx-auto flex h-full w-full max-w-7xl flex-col lg:flex-row">

          {/* ══════════════════════════════════════
              LEFT PANEL — fixed content, no scroll
          ══════════════════════════════════════ */}
          <div className="flex flex-col justify-center px-8 py-10
                          lg:w-[40%] lg:shrink-0 lg:py-14 lg:pl-14 lg:pr-8
                          max-h-[35vh] lg:max-h-none">
            <motion.p
              className="text-[10px] font-bold tracking-[0.2em] text-crimson uppercase"
              initial={reduced ? false : { opacity: 0, x: -12 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4 }}
            >
            </motion.p>

            <motion.h2
              className="mt-2 text-4xl font-extrabold leading-[1.1] text-offwhite lg:text-5xl"
              initial={reduced ? false : { opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: 0.05 }}
            >
              How It{' '}
              <span className="bg-gradient-to-r from-gold via-[#d4c28a] to-gold bg-clip-text text-transparent">
                Works
              </span>
            </motion.h2>

            <motion.div
              initial={reduced ? false : { opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.15 }}
            >
              <PipelineBadge activeIndex={activeIndex} />
            </motion.div>

            <motion.p
              className="mt-5 text-sm leading-relaxed text-offwhite/50 max-w-sm"
              initial={reduced ? false : { opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              Your voice travels through a six-stage AI pipeline — from speech
              recognition to a lip-synced 3D avatar delivering the answer.
            </motion.p>

            {/* progress bar */}
            <div className="mt-8 hidden lg:flex items-center gap-3" aria-hidden="true">
              <div className="h-px flex-1 overflow-hidden rounded-full bg-white/10">
                <motion.div
                  className="h-full bg-gradient-to-r from-crimson/70 to-gold/60 origin-left"
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
              RIGHT PANEL — scroll driven by page
          ══════════════════════════════════════ */}
          <div
            ref={scrollerRef}
            className="flex-1 overflow-hidden px-5 py-10 lg:py-14 lg:pr-14 lg:pl-6"
            aria-label="Pipeline steps timeline"
          >
            <div ref={innerRef}>
              {/* top spacer — puts step 1 at the 35% reference line when scrollTop=0 */}
              <div className="h-[30vh]" aria-hidden="true" />

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

              {/* bottom spacer — lets last card reach the 35% reference line */}
              <div className="h-[50vh]" aria-hidden="true" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

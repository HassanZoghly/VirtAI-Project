import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

// ── SVG Icon Paths (24×24 viewBox) ──────────────────────────
const ICONS = {
  mic: (
    <path
      d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3ZM19 10v2a7 7 0 0 1-14 0v-2M12 19v4m-4 0h8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  waveform: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M2 12h2l2-5 3 10 3-10 3 10 2-5h2" />
      <path d="M20 17h2M2 17h2" opacity=".4" />
    </g>
  ),
  database: (
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 7v10c0 1.66 3.58 3 8 3s8-1.34 8-3V7" />
      <ellipse cx="12" cy="7" rx="8" ry="3" />
      <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
    </g>
  ),
  brain: (
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2a5 5 0 0 1 4.78 3.5A4 4 0 0 1 20 9.5a4 4 0 0 1-1.5 3.12A4.5 4.5 0 0 1 14 18h-4a4.5 4.5 0 0 1-4.5-5.38A4 4 0 0 1 4 9.5a4 4 0 0 1 3.22-3.93A5 5 0 0 1 12 2Z" />
      <path d="M12 2v20M8 8.5h8M8 14h8" opacity=".5" />
    </g>
  ),
  speaker: (
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
    </g>
  ),
  avatar: (
    <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="5" />
      <path d="M20 21a8 8 0 0 0-16 0" />
    </g>
  ),
};

// ── Node Data ────────────────────────────────────────────────
const NODES = [
  {
    id: 0,
    label: 'Voice Input',
    icon: 'mic',
    desc: "Student speaks into the mic. Raw audio is captured in real-time via the browser's MediaRecorder API and streamed as binary frames to the server.",
  },
  {
    id: 1,
    label: 'ASR',
    icon: 'waveform',
    desc: 'Automatic Speech Recognition converts the audio stream to text instantly using Whisper, providing accurate transcription even in noisy classroom environments.',
  },
  {
    id: 2,
    label: 'RAG',
    icon: 'database',
    desc: 'Retrieval-Augmented Generation fetches the most relevant course material from a vector database (embeddings), grounding the response in real lecture content.',
  },
  {
    id: 3,
    label: 'LLM',
    icon: 'brain',
    desc: "The large language model synthesizes retrieved context into a precise, context-aware answer tailored to the student's question and learning level.",
  },
  {
    id: 4,
    label: 'TTS',
    icon: 'speaker',
    desc: 'Text-to-Speech converts the answer into natural-sounding audio along with phoneme timing data needed for accurate lip synchronization.',
  },
  {
    id: 5,
    label: 'Avatar',
    icon: 'avatar',
    desc: 'The 3D avatar lip-syncs and animates in real-time using the phoneme data, delivering the answer with natural facial expressions and gestures.',
  },
];

// ── Layout Constants ─────────────────────────────────────────
const NODE_R = 28;
const ROW_GAP = 100;
const TOP_PAD = 50;
const SVG_W = 120;
const SVG_H = TOP_PAD + (NODES.length - 1) * ROW_GAP + 50;
const MAX_SCROLL = 900;

// ── Main Component ───────────────────────────────────────────
export default function AIPipelineVisualizer() {
  const containerRef = useRef(null);
  const pathRef = useRef(null);

  const [scrollProgress, setScrollProgress] = useState(0);
  const [activeNodeIndex, setActiveNodeIndex] = useState(-1);
  const [pathLen, setPathLen] = useState(0);

  const isLockedRef = useRef(false);
  const scrollDeltaRef = useRef(0);

  // ── Vertical positions ──────────────────────────────────────
  const cx = SVG_W / 2;
  const positions = NODES.map((_, i) => ({ cx, cy: TOP_PAD + i * ROW_GAP }));

  // Straight vertical path
  const d = `M ${cx} ${positions[0].cy} L ${cx} ${positions[positions.length - 1].cy}`;

  // ── Path length ─────────────────────────────────────────────
  useEffect(() => {
    if (pathRef.current) {
      setPathLen(pathRef.current.getTotalLength());
    }
  }, [d]);

  // ── Active node tracking ────────────────────────────────────
  useEffect(() => {
    if (NODES.length === 0) {
      return;
    }
    const frac = 1 / NODES.length;
    const idx = Math.min(NODES.length - 1, Math.floor(scrollProgress / frac));
    setActiveNodeIndex(scrollProgress <= 0 ? -1 : idx);
  }, [scrollProgress]);

  // ── Intersection Observer + Wheel hijack ────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }

    function onWheel(e) {
      if (!isLockedRef.current) {
        return;
      }
      e.preventDefault();
      scrollDeltaRef.current = Math.max(0, Math.min(MAX_SCROLL, scrollDeltaRef.current + e.deltaY));
      setScrollProgress(scrollDeltaRef.current / MAX_SCROLL);
      if (scrollDeltaRef.current >= MAX_SCROLL) {
        unlock();
      } else if (scrollDeltaRef.current <= 0) {
        unlock();
      }
    }

    function lock() {
      if (isLockedRef.current) {
        return;
      }
      isLockedRef.current = true;
      scrollDeltaRef.current = 0;
      setScrollProgress(0);
      document.body.style.overflow = 'hidden';
      el.addEventListener('wheel', onWheel, { passive: false });
    }

    function unlock() {
      if (!isLockedRef.current) {
        return;
      }
      isLockedRef.current = false;
      document.body.style.overflow = '';
      el.removeEventListener('wheel', onWheel);
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.95) {
          lock();
        } else {
          if (isLockedRef.current && scrollDeltaRef.current >= MAX_SCROLL) {
            unlock();
          }
          if (!entry.isIntersecting && isLockedRef.current) {
            unlock();
          }
        }
      },
      { threshold: [0, 0.95, 1.0] }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      unlock();
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  const dashOffset = pathLen > 0 ? pathLen * (1 - scrollProgress) : pathLen;
  const activeNode = activeNodeIndex >= 0 ? NODES[activeNodeIndex] : null;

  return (
    <section
      id="how-it-works"
      ref={containerRef}
      className="relative flex h-screen w-full select-none flex-col items-center justify-center overflow-hidden bg-dark px-6"
    >
      {/* ── Heading ───────────────────────────────────────── */}
      <motion.h3
        className="mb-2 text-center text-4xl font-bold text-offwhite sm:text-5xl"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.6 }}
      >
        How It <span className="text-crimson">Works</span>
      </motion.h3>
      <motion.p
        className="mb-8 text-center text-sm tracking-widest text-offwhite/30 uppercase"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.2 }}
      >
        Voice → ASR → RAG → LLM → TTS → Avatar
      </motion.p>

      {/* ── Split Layout ──────────────────────────────────── */}
      <div className="flex w-full max-w-5xl flex-1 items-center gap-8 lg:gap-14">
        {/* ── LEFT: Vertical Pipeline ─────────────────────── */}
        <div className="flex shrink-0 items-center justify-center" style={{ width: SVG_W + 80 }}>
          <svg
            width={SVG_W}
            height={SVG_H}
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            className="block overflow-visible"
          >
            <defs>
              <linearGradient id="pipeGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#B5AC8A" />
                <stop offset="50%" stopColor="#6D001A" />
                <stop offset="100%" stopColor="#B5AC8A" />
              </linearGradient>
              <filter id="glowFilter">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Background path */}
            <path
              d={d}
              fill="none"
              stroke="rgba(245,241,236,0.06)"
              strokeWidth={2}
              strokeLinecap="round"
            />

            {/* Active flow path */}
            <path
              ref={pathRef}
              d={d}
              fill="none"
              stroke="url(#pipeGrad)"
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray={pathLen}
              strokeDashoffset={dashOffset}
              filter="url(#glowFilter)"
              style={{ transition: 'stroke-dashoffset 0.06s linear' }}
            />

            {/* Nodes */}
            {positions.map((pos, i) => {
              const active = i <= activeNodeIndex;
              const node = NODES[i];
              const isCurrent = i === activeNodeIndex;
              return (
                <g key={node.id}>
                  {/* Outer glow ring */}
                  <circle
                    cx={pos.cx}
                    cy={pos.cy}
                    r={NODE_R + 6}
                    fill="none"
                    stroke={
                      isCurrent
                        ? 'rgba(109,0,26,0.5)'
                        : active
                          ? 'rgba(109,0,26,0.2)'
                          : 'transparent'
                    }
                    strokeWidth={2}
                    style={{ transition: 'stroke 0.4s ease' }}
                  />
                  {/* Node circle */}
                  <circle
                    cx={pos.cx}
                    cy={pos.cy}
                    r={NODE_R}
                    fill={active ? 'rgba(109,0,26,0.25)' : 'rgba(245,241,236,0.04)'}
                    stroke={active ? '#B5AC8A' : 'rgba(245,241,236,0.12)'}
                    strokeWidth={isCurrent ? 2.5 : 1.5}
                    style={{
                      transition: 'all 0.4s ease',
                      filter: isCurrent
                        ? 'drop-shadow(0 0 16px rgba(109,0,26,0.6))'
                        : active
                          ? 'drop-shadow(0 0 8px rgba(109,0,26,0.3))'
                          : 'none',
                    }}
                  />
                  {/* SVG Icon */}
                  <svg
                    x={pos.cx - 10}
                    y={pos.cy - 10}
                    width={20}
                    height={20}
                    viewBox="0 0 24 24"
                    style={{
                      color: active ? '#B5AC8A' : 'rgba(245,241,236,0.4)',
                      transition: 'color 0.4s ease',
                      pointerEvents: 'none',
                    }}
                  >
                    {ICONS[node.icon]}
                  </svg>
                  {/* Label */}
                  <text
                    x={pos.cx}
                    y={pos.cy + NODE_R + 16}
                    textAnchor="middle"
                    fill={active ? '#B5AC8A' : 'rgba(245,241,236,0.35)'}
                    fontSize={10}
                    fontWeight={600}
                    letterSpacing={1}
                    fontFamily="'Inter', system-ui, sans-serif"
                    style={{ transition: 'fill 0.4s ease', pointerEvents: 'none' }}
                  >
                    {node.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* ── RIGHT: Description Panel ────────────────────── */}
        <div className="flex min-h-70 flex-1 items-center justify-center">
          <AnimatePresence mode="wait">
            {activeNode ? (
              <motion.div
                key={activeNode.id}
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.35, ease: 'easeOut' }}
                className="max-w-md"
              >
                {/* Step indicator */}
                <div className="mb-3 text-xs font-semibold tracking-[0.25em] uppercase text-crimson/70">
                  Step {activeNodeIndex + 1} / {NODES.length}
                </div>
                {/* Node title */}
                <h4 className="mb-4 text-3xl font-bold text-offwhite lg:text-4xl">
                  {activeNode.label}
                </h4>
                {/* Accent line */}
                <div className="mb-4 h-0.5 w-16 rounded-full bg-gold/40" />
                {/* Description */}
                <p className="text-base leading-relaxed text-offwhite/60 lg:text-lg">
                  {activeNode.desc}
                </p>
              </motion.div>
            ) : (
              <motion.div
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="text-center"
              >
                <p className="text-sm tracking-widest text-offwhite/20 uppercase">
                  Scroll to explore each stage
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Scroll hint */}
      <div
        className="absolute bottom-6 left-1/2 -translate-x-1/2 text-xs tracking-widest text-offwhite/20 uppercase transition-opacity duration-500"
        style={{ opacity: scrollProgress < 0.05 ? 1 : 0 }}
      >
        ↓ scroll to explore ↓
      </div>
    </section>
  );
}

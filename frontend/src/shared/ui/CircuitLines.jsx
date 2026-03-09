import { cn } from '@/shared/utils/cn';
import { motion, useScroll, useTransform } from 'motion/react';
import { useRef } from 'react';

const paths = [
  'M 0 200 Q 120 180 240 220 T 480 200 T 720 180 T 960 210',
  'M 0 400 Q 200 370 400 410 T 800 390 T 960 400',
  'M 0 600 Q 150 580 300 620 T 600 590 T 960 610',
];

function GlowDot({ progress, path, color }) {
  const x = useTransform(progress, [0, 1], [0, 960]);

  return (
    <motion.circle
      r="4"
      fill={color}
      filter={`drop-shadow(0 0 6px ${color})`}
      style={{ cx: x, cy: 0 }}
    >
      <animateMotion dur="0s" fill="freeze">
        <mpath href={`#${path}`} />
      </animateMotion>
    </motion.circle>
  );
}

export default function CircuitLines({ className }) {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });

  const dot1 = useTransform(scrollYProgress, [0, 1], [0, 1]);
  const dot2 = useTransform(scrollYProgress, [0.1, 0.9], [0, 1]);
  const dot3 = useTransform(scrollYProgress, [0.2, 0.8], [0, 1]);

  const dots = [
    { progress: dot1, path: 'circuit-0', color: '#6D001A' },
    { progress: dot2, path: 'circuit-1', color: '#B5AC8A' },
    { progress: dot3, path: 'circuit-2', color: '#6D001A' },
  ];

  return (
    <div
      ref={ref}
      className={cn('pointer-events-none absolute inset-0 overflow-hidden opacity-20', className)}
      aria-hidden="true"
    >
      <svg viewBox="0 0 960 800" fill="none" preserveAspectRatio="none" className="h-full w-full">
        {paths.map((d, i) => (
          <path
            key={i}
            id={`circuit-${i}`}
            d={d}
            stroke="currentColor"
            strokeWidth="1"
            className="text-gold/30"
          />
        ))}

        {dots.map((dot, i) => (
          <GlowDot key={i} {...dot} />
        ))}
      </svg>
    </div>
  );
}

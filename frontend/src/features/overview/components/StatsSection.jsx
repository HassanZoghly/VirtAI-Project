import { animate, motion, useInView } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

const stats = [
  { id: 1, value: 5, suffix: '+', label: 'Team Members' },
  { id: 2, value: 6, suffix: '', label: 'Pipeline Stages' },
  { id: 3, value: 70, suffix: '%', label: 'Real-time Processing' },
];

function CountUp({ target, suffix }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView) {
      return;
    }
    const controls = animate(0, target, {
      duration: 1.4,
      ease: 'easeOut',
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [inView, target]);

  return (
    <span ref={ref}>
      {display}
      {suffix}
    </span>
  );
}

export default function StatsSection() {
  return (
    <section className="relative mx-auto max-w-4xl px-6 py-28">
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
        {stats.map((s, i) => (
          <motion.div
            key={s.id}
            className="flex flex-col items-center gap-2"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.5, delay: i * 0.12 }}
          >
            <span className="text-5xl font-extrabold text-crimson">
              <CountUp target={s.value} suffix={s.suffix} />
            </span>
            <span className="text-base text-offwhite/60">{s.label}</span>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

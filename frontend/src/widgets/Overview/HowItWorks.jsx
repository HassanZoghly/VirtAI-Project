import { howItWorks as steps } from '@/features/overview';
import { motion } from 'motion/react';

export default function HowItWorks() {
  return (
    <section className="relative mx-auto max-w-5xl px-6 py-28">
      <motion.h2
        className="mb-16 text-center text-4xl font-bold text-offwhite sm:text-5xl"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.6 }}
      >
        How It <span className="text-crimson">Works</span>
      </motion.h2>

      <div className="relative">
        {/* Vertical connector line */}
        <div className="absolute left-6 top-0 bottom-0 w-px bg-gradient-to-b from-crimson/40 via-gold/30 to-transparent sm:left-1/2 sm:-translate-x-px" />

        <div className="flex flex-col gap-12">
          {steps.map((s, i) => {
            const isEven = i % 2 === 0;
            return (
              <motion.div
                key={s.step}
                className="relative flex items-start gap-6 sm:items-center"
                initial={{ opacity: 0, x: isEven ? -30 : 30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
              >
                {/* Step number dot */}
                <div className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-crimson/40 bg-dark text-sm font-bold text-crimson shadow-[0_0_16px_rgba(109,0,26,0.3)] sm:absolute sm:left-1/2 sm:-translate-x-1/2">
                  {s.step}
                </div>

                {/* Card — alternates sides on sm+ */}
                <div
                  className={`flex-1 rounded-2xl border border-white/10 bg-dark/60 p-5 backdrop-blur-sm sm:w-[calc(50%-3rem)] ${
                    isEven
                      ? 'sm:mr-auto sm:pr-10 sm:text-right'
                      : 'sm:ml-auto sm:pl-10 sm:text-left'
                  }`}
                >
                  <h4 className="text-lg font-semibold text-offwhite">{s.label}</h4>
                  <p className="mt-1 text-sm text-offwhite/70">{s.description}</p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

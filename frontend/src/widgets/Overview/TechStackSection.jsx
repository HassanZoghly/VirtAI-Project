import techStack from '@/features/overview/data/techStack';
import { motion } from 'motion/react';

export default function TechStackSection() {
  return (
    <section id="tech-stack" className="relative mx-auto max-w-5xl px-6 py-28">
      <motion.h2
        className="mb-14 text-center text-4xl font-bold text-offwhite sm:text-5xl"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.6 }}
      >
        Tech <span className="text-gold">Stack</span>
      </motion.h2>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {techStack.map((t, i) => {
          const Icon = t.icon;
          return (
            <motion.div
              key={t.id}
              className="group flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-dark/60 p-6 backdrop-blur-sm transition-colors hover:border-gold/30"
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.4, delay: i * 0.06 }}
              whileHover={{ y: -4 }}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-crimson/10 text-crimson transition-colors group-hover:bg-crimson/20">
                <Icon className="h-6 w-6" />
              </div>
              <span className="text-sm font-medium text-offwhite/80">{t.label}</span>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

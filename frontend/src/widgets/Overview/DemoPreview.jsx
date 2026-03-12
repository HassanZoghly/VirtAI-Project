import { motion } from 'motion/react';

export default function DemoPreview() {
  return (
    <section className="relative mx-auto max-w-5xl px-6 py-28">
      <motion.h2
        className="mb-14 text-center text-4xl font-bold text-offwhite sm:text-5xl"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.6 }}
      >
        See It in <span className="text-crimson">Action</span>
      </motion.h2>

      <motion.div
        className="relative mx-auto max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-dark/80 shadow-2xl"
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.7 }}
      >
        {/* Browser chrome bar */}
        <div className="flex items-center gap-2 border-b border-white/10 bg-dark px-4 py-3">
          <span className="h-3 w-3 rounded-full bg-red-500/70" />
          <span className="h-3 w-3 rounded-full bg-yellow-500/70" />
          <span className="h-3 w-3 rounded-full bg-green-500/70" />
          <span className="ml-4 flex-1 rounded-md bg-white/5 px-3 py-1 text-xs text-offwhite/60">
            localhost:3000/classroom
          </span>
        </div>

        {/* Screenshot */}
        <img
          src="/assets/images/demo.webp"
          alt="VirtAI classroom demo"
          width={896}
          height={504}
          className="block w-full"
          loading="lazy"
          decoding="async"
        />
      </motion.div>
    </section>
  );
}

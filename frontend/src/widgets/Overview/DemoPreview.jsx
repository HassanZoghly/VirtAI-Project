import { motion } from 'motion/react';

export default function DemoPreview() {
  return (
    <section id="demo" className="relative mx-auto max-w-5xl px-6 py-28">
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
        className="relative mx-auto max-w-4xl overflow-hidden rounded-2xl border border-white/12 bg-dark/70"
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.7 }}
      >
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

      <p className="mx-auto mt-5 max-w-lg text-center text-sm leading-relaxed text-offwhite/62">
        A single classroom surface where voice input, retrieval, and avatar delivery stay in sync.
      </p>
    </section>
  );
}

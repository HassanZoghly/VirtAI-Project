import { motion } from 'motion/react';

export default function HeroSection({ onCTA }) {
  const fadeUp = {
    initial: { opacity: 0, y: 24 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] },
  };

  return (
    <section className="relative flex min-h-[88vh] items-center px-6 py-20 sm:px-10 lg:px-16 lg:py-24">
      <div className="mx-auto grid w-full max-w-7xl gap-14 lg:grid-cols-12 lg:items-center">
        <div className="lg:col-span-7">
          <motion.p
            className="text-sm font-semibold tracking-[0.14em] text-gold/90 uppercase"
            {...fadeUp}
          >
            Trusted AI infrastructure for education
          </motion.p>

          <motion.h1
            className="mt-6 max-w-[16ch] text-5xl font-black leading-[1.02] text-offwhite sm:text-6xl lg:text-7xl"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.75, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
          >
            Deploy an AI teaching assistant your institution can rely on.
          </motion.h1>

          <motion.p
            className="mt-7 max-w-[62ch] text-lg leading-relaxed text-offwhite/78"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.16, ease: [0.16, 1, 0.3, 1] }}
          >
            VirtAI combines real-time voice interaction, curriculum-aware reasoning, and avatar
            delivery in one production-ready platform.
          </motion.p>

          <motion.div
            className="mt-10 flex flex-wrap items-center gap-4"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.24, ease: [0.16, 1, 0.3, 1] }}
          >
            <button
              onClick={onCTA}
              className="inline-flex cursor-pointer items-center justify-center rounded-full bg-offwhite px-7 py-3 text-sm font-semibold tracking-wide text-dark transition-colors duration-200 hover:bg-offwhite/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-dark"
            >
              Request demo
            </button>
            <a
              href="#demo"
              className="inline-flex items-center justify-center rounded-full border border-offwhite/20 px-7 py-3 text-sm font-semibold tracking-wide text-offwhite transition-colors duration-200 hover:border-offwhite/35 hover:text-offwhite/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-dark"
            >
              View platform
            </a>
          </motion.div>

          <motion.ul
            className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm text-offwhite/65"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.32, ease: [0.16, 1, 0.3, 1] }}
          >
            <li className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-gold/85" />
              Privacy-first
            </li>
            <li className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-gold/85" />
              Low-latency voice
            </li>
            <li className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-gold/85" />
              Classroom-ready architecture
            </li>
          </motion.ul>
        </div>

        <motion.div
          className="lg:col-span-5"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <figure className="overflow-hidden rounded-2xl border border-offwhite/12 bg-[#201f1d]">
            <img
              src="/assets/images/image.webp"
              alt="VirtAI platform classroom preview"
              className="block w-full object-cover"
              fetchPriority="high"
              width={896}
              height={504}
              loading="eager"
            />
          </figure>
        </motion.div>
      </div>
    </section>
  );
}

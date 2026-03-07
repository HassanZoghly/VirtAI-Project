import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';

export default function SplashScreen({ onComplete }) {
  const [done, setDone] = useState(false);

  return (
    <AnimatePresence>
      {!done && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-dark"
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6 }}
          onAnimationComplete={(def) => {
            /* only fire after the exit animation */
            if (def?.opacity === 0) {
              onComplete?.();
            }
          }}
        >
          {/* glow ring */}
          <motion.div
            className="absolute rounded-full"
            style={{ width: 260, height: 260 }}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: [0, 0.5, 0], scale: [0.6, 1.3, 1.5] }}
            transition={{ duration: 2, ease: 'easeOut' }}
          >
            <div className="h-full w-full rounded-full bg-crimson/30 blur-3xl" />
          </motion.div>

          {/* logo */}
          <motion.img
            src="/assets/logo.svg"
            alt="VirtAI logo"
            className="relative h-160 w-160 drop-shadow-[0_0_60px_rgba(109,0,26,0.6)]"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
          />

          {/* title */}
          <motion.h1
            className="absolute mt-164 text-4xl font-bold tracking-wide text-offwhite"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.7 }}
          >
            Welcome to the Future of Teaching
          </motion.h1>

          {/* auto-dismiss */}
          <motion.div
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 2.8 }}
            onAnimationComplete={() => setDone(true)}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

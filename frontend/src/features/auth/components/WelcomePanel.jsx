import { motion } from 'motion/react';

const pulseVariants = {
  animate: {
    scale: [1, 1.05, 1],
    opacity: [0.5, 0.8, 0.5],
    transition: { duration: 4, repeat: Infinity, ease: 'easeInOut' },
  },
};

export default function WelcomePanel() {
  return (
    <div className="relative hidden h-full overflow-hidden lg:flex lg:flex-col lg:items-center lg:justify-center">
      {/* Background gradient */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(135deg, var(--color-dark) 0%, #2a0a14 50%, var(--color-dark) 100%)',
        }}
      />

      {/* Grid pattern overlay */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* Decorative glow orbs */}
      <motion.div
        variants={pulseVariants}
        animate="animate"
        className="absolute -left-20 -top-20 h-72 w-72 rounded-full"
        style={{
          background: 'radial-gradient(circle, rgba(109,0,26,0.3) 0%, transparent 70%)',
        }}
      />
      <motion.div
        variants={pulseVariants}
        animate="animate"
        className="absolute -bottom-16 -right-16 h-60 w-60 rounded-full"
        style={{
          background: 'radial-gradient(circle, rgba(181,172,138,0.2) 0%, transparent 70%)',
          animationDelay: '2s',
        }}
      />

      {/* Content */}
      <div className="relative z-10 flex max-w-md flex-col items-center px-12 text-center">
        {/* Logo */}
        <img
          src="/assets/icons/profile.svg"
          alt="VirtAI"
          width={80}
          height={80}
          className="mb-4 h-20 w-auto"
          decoding="async"
        />

        {/* Tagline */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.35 }}
          className="mb-6 text-lg font-medium"
          style={{ color: 'var(--color-gold)' }}
        >
          Your AI-Powered Virtual Classroom
        </motion.p>

        {/* Description */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="text-sm leading-relaxed"
          style={{ color: 'var(--text-secondary)' }}
        >
          Experience immersive learning with a lifelike AI avatar that listens, speaks, and adapts
          to you in real time.
        </motion.p>

        {/* Feature pills */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.65 }}
          className="mt-8 flex flex-wrap justify-center gap-2"
        >
          {['Voice Chat', 'Smart Tutor', '3D Avatar'].map((feature) => (
            <span
              key={feature}
              className="rounded-full border px-3 py-1 text-xs font-medium"
              style={{
                borderColor: 'rgba(181,172,138,0.25)',
                color: 'var(--color-gold)',
                background: 'rgba(181,172,138,0.08)',
              }}
            >
              {feature}
            </span>
          ))}
        </motion.div>
      </div>

      {/* Bottom decorative line */}
      <div
        className="absolute bottom-0 left-0 right-0 h-px"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, var(--color-gold) 50%, transparent 100%)',
          opacity: 0.2,
        }}
      />
    </div>
  );
}

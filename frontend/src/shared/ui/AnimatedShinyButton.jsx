import { cn } from '@/shared/utils/cn';
import { motion } from 'motion/react';

export default function AnimatedShinyButton({ children, className, onClick, ...props }) {
  return (
    <motion.button
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className={cn(
        'group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-full',
        'bg-crimson px-8 py-3 text-offwhite font-semibold tracking-wide',
        'transition-shadow duration-300 hover:shadow-[0_0_32px_rgba(109,0,26,0.45)]',
        className
      )}
      {...props}
    >
      {/* animated shine sweep */}
      <span
        className="pointer-events-none absolute inset-0 -translate-x-full bg-linear-to-r from-transparent via-white/20 to-transparent
          transition-transform duration-700 ease-in-out group-hover:translate-x-full"
      />
      <span className="relative z-10 flex items-center gap-2">{children}</span>
    </motion.button>
  );
}

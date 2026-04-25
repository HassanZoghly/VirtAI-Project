import { cn } from '@/shared/utils/cn';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';

export default function CardHoverEffect({ items, className }) {
  const [hoveredIdx, setHoveredIdx] = useState(null);

  return (
    <div className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {items.map((item, idx) => {
        const Icon = item.icon;
        return (
          <div
            key={item.id ?? idx}
            className={cn(
              'group relative block h-full w-full p-2',
              item.colSpan === 2 && 'sm:col-span-2 lg:col-span-2'
            )}
            onMouseEnter={() => setHoveredIdx(idx)}
            onMouseLeave={() => setHoveredIdx(null)}
          >
            <AnimatePresence>
              {hoveredIdx === idx && (
                <motion.span
                  className="absolute inset-0 z-0 block rounded-2xl bg-gold/15"
                  layoutId="card-hover-bg"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { duration: 0.2 } }}
                  exit={{ opacity: 0, transition: { duration: 0.15, delay: 0.1 } }}
                />
              )}
            </AnimatePresence>

            <div
              className={cn(
                'relative z-10 h-full overflow-hidden rounded-2xl border border-white/10 bg-dark/60 p-6 backdrop-blur-sm',
                'transition-colors duration-200 group-hover:border-gold/30'
              )}
            >
              {Icon && (
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-crimson/10 text-2xl text-crimson">
                  <Icon className="h-6 w-6" />
                </div>
              )}
              <h3 className="mb-2 text-lg font-semibold text-offwhite">{item.title}</h3>
              <p className="max-w-[65ch] text-sm leading-relaxed text-offwhite/60">{item.description}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

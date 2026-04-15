import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';

const NAV_ITEMS = [
  { label: 'Features', target: 'features' },
  { label: 'How It Works', target: 'how-it-works' },
  { label: 'Demo', target: 'demo' },
  { label: 'Tech Stack', target: 'tech-stack' },
];

export default function Navbar() {
  const [visible, setVisible] = useState(false);
  const [activeId, setActiveId] = useState('');

  /* show/hide based on scroll past hero + force "team" when at page bottom */
  useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > window.innerHeight * 0.6);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* highlight active section via IntersectionObserver */
  useEffect(() => {
    const ids = NAV_ITEMS.map((n) => n.target);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: '-40% 0px -55% 0px' }
    );

    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        observer.observe(el);
      }
    });
    return () => observer.disconnect();
  }, []);

  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.nav
          key="navbar"
          initial={{ y: -72, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -72, opacity: 0 }}
          transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
          className="fixed top-0 right-0 left-0 z-50 flex h-16 items-center justify-between border-b border-white/10 bg-dark/80 px-6 backdrop-blur-md"
        >
          {/* logo */}
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            aria-label="Scroll to top"
            className="flex shrink-0 items-center gap-2"
          >
            <span
              className="text-lg font-semibold tracking-wide text-offwhite"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              VirtAI
            </span>
          </button>

          {/* nav links */}
          <ul className="flex items-center gap-8">
            {NAV_ITEMS.map(({ label, target }) => (
              <li key={target}>
                <button
                  onClick={() => scrollTo(target)}
                  className="relative cursor-pointer px-1 py-2 text-sm font-medium tracking-wide transition-colors duration-200"
                  style={{
                    fontFamily: 'var(--font-display)',
                    color: activeId === target ? '#b5ac8a' : '#f5f1ec',
                  }}
                >
                  {label}
                  {activeId === target && (
                    <motion.span
                      layoutId="nav-underline"
                      className="absolute bottom-0 left-0 h-0.5 w-full rounded-full bg-gold"
                      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </motion.nav>
      )}
    </AnimatePresence>
  );
}

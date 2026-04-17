import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

const NAV_ITEMS = [
  { label: 'Features', target: 'features' },
  { label: 'How It Works', target: 'how-it-works' },
  { label: 'Tech Stack', target: 'tech-stack' },
];

export default function Navbar() {
  const [visible, setVisible] = useState(false);
  const [activeId, setActiveId] = useState('');
  const isScrolling = useRef(false);

  /* show/hide based on scroll past hero */
  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          setVisible(window.scrollY > window.innerHeight * 0.6);
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* highlight active section via IntersectionObserver */
  useEffect(() => {
    const ids = NAV_ITEMS.map((n) => n.target);
    const visibleSections = new Set();

    const observer = new IntersectionObserver(
      (entries) => {
        if (isScrolling.current) { return; }

        let hasChanges = false;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visibleSections.add(entry.target.id);
            hasChanges = true;
          } else {
            visibleSections.delete(entry.target.id);
            hasChanges = true;
          }
        }

        if (hasChanges) {
          if (visibleSections.size === 0) {
            setActiveId('');
          } else {
            const visibleArray = Array.from(visibleSections);
            const active = ids.find((id) => visibleArray.includes(id));
            if (active) { setActiveId(active); }
          }
        }
      },
      { rootMargin: '-40% 0px -55% 0px' }
    );

    // Give DOM time to paint conditional elements
    const timeoutId = setTimeout(() => {
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) { observer.observe(el); }
      });
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      observer.disconnect();
    };
  }, []);

  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (!el) { return; }

    isScrolling.current = true;
    setActiveId(id);

    const offset = 80;
    const y = el.getBoundingClientRect().top + window.scrollY - offset;

    window.scrollTo({ top: y, behavior: 'smooth' });

    // Release lock after smooth scroll completes
    setTimeout(() => {
      isScrolling.current = false;
    }, 800);
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
            onClick={scrollToTop}
            aria-label="Scroll to top"
            className="flex shrink-0 cursor-pointer items-center gap-2"
          >
            <span
              className="text-lg font-semibold tracking-wide text-offwhite"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              VirtAI
            </span>
          </button>

          {/* nav links and CTA */}
          <div className="flex items-center gap-8">
            <ul className="flex items-center gap-8">
              {NAV_ITEMS.map(({ label, target }) => (
                <li key={target}>
                  <a
                    href={`#${target}`}
                    onClick={(e) => {
                      e.preventDefault();
                      scrollTo(target);
                    }}
                    className="relative block cursor-pointer px-1 py-2 text-sm font-medium tracking-wide transition-colors duration-200"
                    style={{
                      fontFamily: 'var(--font-display)',
                      color: activeId === target ? '#B4AB8B' : '#f5f1ec',
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
                  </a>
                </li>
              ))}
            </ul>

            {/* Demo CTA Button */}
            <button
              onClick={() => scrollTo('demo')}
              className="cursor-pointer rounded-full bg-offwhite px-5 py-2 text-sm font-semibold tracking-wide text-dark transition-transform duration-200 hover:scale-105"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Demo
            </button>
          </div>
        </motion.nav>
      )}
    </AnimatePresence>
  );
}

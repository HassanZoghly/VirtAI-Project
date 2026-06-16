import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState, useId } from 'react';

export default function SlideDrawer({
  title,
  description,
  isOpen,
  onClose,
  children,
  className = '',
  contentClassName = '',
  zIndex = 1000,
  enableDrag = false,
}) {
  const drawerRef = useRef(null);
  const previousFocusRef = useRef(null);
  const [isMobile, setIsMobile] = useState(false);
  const id = useId();

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1023px)');
    const handleChange = (e) => setIsMobile(e.matches);
    setIsMobile(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // Focus restoration
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement;
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [isOpen]);

  // Focus first focusable element on open
  useEffect(() => {
    if (!isOpen || !drawerRef.current) return;
    const firstFocusable = drawerRef.current.querySelector(
      'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    requestAnimationFrame(() => firstFocusable?.focus());
  }, [isOpen]);

  // Escape key handler
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Focus trap
  const handleKeyDown = useCallback((e) => {
    if (e.key !== 'Tab') {
      return;
    }
    const drawer = drawerRef.current;
    if (!drawer) {
      return;
    }
    const focusable = Array.from(
      drawer.querySelectorAll(
        'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => !el.disabled && el.offsetParent !== null);
    if (focusable.length === 0) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className={`slide-drawer open ${className}`} style={{ zIndex }}>
          <motion.div
            className="drawer-overlay"
            onClick={onClose}
            role="presentation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
          <motion.div
            className={`drawer-content ${contentClassName}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? `${id}-title` : undefined}
            aria-describedby={description ? `${id}-desc` : undefined}
            ref={drawerRef}
            onKeyDown={handleKeyDown}
            drag={isMobile && enableDrag ? 'y' : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0}
            onDragEnd={(e, info) => {
              if (isMobile && enableDrag && info.offset.y > 100) {
                onClose();
              }
            }}
            initial={isMobile ? { y: '100%' } : { x: '100%' }}
            animate={isMobile ? { y: 0 } : { x: 0 }}
            exit={isMobile ? { y: '100%' } : { x: '100%' }}
            transition={{ type: 'tween', ease: [0.2, 0.8, 0.2, 1], duration: 0.3 }}
          >
            {isMobile && (
              <div
                className="drawer-drag-handle"
                style={
                  enableDrag
                    ? {
                        width: '40px',
                        height: '5px',
                        background: 'var(--border-color)',
                        margin: '12px auto 0',
                        borderRadius: '4px',
                        flexShrink: 0,
                      }
                    : undefined
                }
              />
            )}
            {title && <h2 id={`${id}-title`} className="sr-only">{title}</h2>}
            {description && <p id={`${id}-desc`} className="sr-only">{description}</p>}
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

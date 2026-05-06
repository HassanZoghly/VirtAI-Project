import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import SessionList from './SessionList';

/**
 * Side drawer for settings, session list, current session info, and tutor status.
 * @param {object} props
 * @param {boolean} props.isOpen - Whether the drawer is visible
 * @param {() => void} props.onClose - Close callback
 * @param {{ id: string, title: string }[]} props.sessions - All chat sessions
 * @param {string} props.currentSessionId - Active session ID
 * @param {(id: string) => void} props.onSessionSelect - Session switch callback
 * @param {() => void} props.onNewSession - New session callback
 * @param {(id: string) => void} props.onDeleteSession - Delete session callback
 * @param {(id: string, title: string) => void} props.onRenameSession - Rename session callback
 */
export default function SettingsDrawer({
  isOpen,
  onClose,
  sessions,
  currentSessionId,
  onSessionSelect,
  onNewSession,
  onDeleteSession,
  onRenameSession,
}) {
  const drawerRef = useRef(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

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
    const focusable = drawer.querySelectorAll(
      'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'
    );
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
        <div className="settings-drawer open">
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
            className="drawer-content sidebar-minimal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-drawer-title"
            ref={drawerRef}
            onKeyDown={handleKeyDown}
            drag={isMobile ? 'y' : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.2}
            onDragEnd={(e, info) => {
              if (isMobile && info.offset.y > 100) {
                onClose();
              }
            }}
            initial={isMobile ? { y: '100%' } : { x: '100%' }}
            animate={isMobile ? { y: 0 } : { x: 0 }}
            exit={isMobile ? { y: '100%' } : { x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          >
            {isMobile && (
              <div
                className="drawer-drag-handle"
                style={{
                  width: '40px',
                  height: '5px',
                  background: 'var(--border-color)',
                  margin: '12px auto 0',
                  borderRadius: '4px',
                  flexShrink: 0,
                }}
              />
            )}
            <div
              className="drawer-body"
              style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '1rem 0', minHeight: 0 }}
            >
              <SessionList
                sessions={sessions}
                currentSessionId={currentSessionId}
                onSessionSelect={onSessionSelect}
                onNewSession={onNewSession}
                onDeleteSession={onDeleteSession}
                onRenameSession={onRenameSession}
                onCloseDrawer={onClose}
              />
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

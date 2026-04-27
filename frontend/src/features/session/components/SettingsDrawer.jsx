import { useCallback, useEffect, useRef } from 'react';
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

  if (!isOpen) {
    return null;
  }

  return (
    <div className="settings-drawer open">
      <div className="drawer-overlay" onClick={onClose} role="presentation" />
      <div
        className="drawer-content sidebar-minimal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-drawer-title"
        ref={drawerRef}
        onKeyDown={handleKeyDown}
      >
        <div className="drawer-body" style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '1rem 0' }}>
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
      </div>
    </div>
  );
}

import { useMemo, useEffect, useRef, useCallback } from 'react';
import {
  PiXFill,
  PiClockFill,
  PiTrayFill,
  PiRobotFill,
  PiUserCircleFill,
  PiWifiSlashFill,
  PiSlidersHorizontalFill,
  PiChatCircleTextFill,
} from 'react-icons/pi';
import SessionList from './SessionList';

/**
 * Side drawer for settings, session list, current session info, and tutor status.
 * @param {object} props
 * @param {boolean} props.isOpen - Whether the drawer is visible
 * @param {() => void} props.onClose - Close callback
 * @param {{ id: string, title: string }[]} props.sessions - All chat sessions
 * @param {string} props.currentSessionId - Active session ID
 * @param {{ messages: { role: string }[] }} props.currentSession - Active session data
 * @param {string} props.avatarName - Tutor display name
 * @param {'online'|'offline'|'checking'} props.backendStatus - Server connection status
 * @param {(id: string) => void} props.onSessionSelect - Session switch callback
 * @param {() => void} props.onNewSession - New session callback
 * @param {(id: string) => void} props.onDeleteSession - Delete session callback
 * @param {(id: string) => void} props.onRenameClick - Rename session callback
 */
export default function SettingsDrawer({
  isOpen,
  onClose,
  sessions,
  currentSessionId,
  currentSession,
  avatarName,
  backendStatus,
  onSessionSelect,
  onNewSession,
  onDeleteSession,
  onRenameClick,
}) {
  const userMessageCount = useMemo(
    () => currentSession.messages.filter((m) => m.role === 'user').length,
    [currentSession.messages],
  );

  const drawerRef = useRef(null);

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Focus trap
  const handleKeyDown = useCallback((e) => {
    if (e.key !== 'Tab') return;
    const drawer = drawerRef.current;
    if (!drawer) return;
    const focusable = drawer.querySelectorAll(
      'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
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
        className="drawer-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-drawer-title"
        ref={drawerRef}
        onKeyDown={handleKeyDown}
      >
        <div className="drawer-header">
          <div className="drawer-title-group">
            <PiSlidersHorizontalFill className="drawer-title-icon" />
            <h2 className="drawer-title" id="settings-drawer-title">Settings</h2>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close settings">
            <PiXFill />
          </button>
        </div>

        <div className="drawer-body">
          <SessionList
            sessions={sessions}
            currentSessionId={currentSessionId}
            onSessionSelect={onSessionSelect}
            onNewSession={onNewSession}
            onDeleteSession={onDeleteSession}
            onRenameClick={onRenameClick}
          />

          <div className="drawer-section">
            <h3 className="drawer-section-title">
              <PiClockFill /> Current Session
            </h3>
            {userMessageCount > 0 ? (
              <div className="drawer-info-row">
                <PiChatCircleTextFill className="drawer-info-icon" />
                <span className="drawer-info-label">Messages</span>
                <span className="drawer-info-value">{userMessageCount}</span>
              </div>
            ) : (
              <div className="empty-state">
                <PiTrayFill />
                <p>No messages yet</p>
              </div>
            )}
          </div>
        </div>

        <div className="drawer-footer">
          <div className="drawer-section">
            <h3 className="drawer-section-title">
              <PiRobotFill /> Tutor
            </h3>
            <div className="drawer-info-row">
              <PiUserCircleFill className="drawer-info-icon" />
              <span className="drawer-info-label">Active tutor</span>
              <span className="drawer-info-value">{avatarName}</span>
            </div>
            <div className="drawer-info-row">
              <PiWifiSlashFill
                className="drawer-info-icon"
                style={{
                  color: backendStatus === 'offline' ? '#ef4444' : 'var(--success)',
                }}
              />
              <span className="drawer-info-label">Server</span>
              <span
                className="drawer-info-value"
                style={{
                  color:
                    backendStatus === 'offline'
                      ? '#ef4444'
                      : backendStatus === 'checking'
                        ? 'var(--warning)'
                        : 'var(--success)',
                }}
              >
                {backendStatus === 'offline'
                  ? 'Offline'
                  : backendStatus === 'checking'
                    ? 'Checking…'
                    : 'Online'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useLogout } from '@/features/auth/hooks/useAuth';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FiLogOut } from 'react-icons/fi';
import {
  PiChatCircleTextFill,
  PiChatsFill,
  PiPencilSimpleFill,
  PiPlusFill,
  PiTrashSimpleFill,
  PiUserGearFill,
} from 'react-icons/pi';
import { useNavigate } from 'react-router-dom';

/** Format a timestamp to a short relative / absolute label. */
function formatTime(ts) {
  if (!ts) {
    return '';
  }
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) {
    return 'Just now';
  }
  if (diffMin < 60) {
    return `${diffMin}m`;
  }
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) {
    return `${diffH}h`;
  }
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) {
    return `${diffD}d`;
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Scrollable list of chat sessions with new/rename/delete actions.
 * Right-click a chat item to open the floating context menu.
 * @param {object} props
 * @param {{ id: string, title: string, messages: any[], createdAt?: number }[]} props.sessions
 * @param {string} props.currentSessionId
 * @param {(id: string) => void} props.onSessionSelect
 * @param {() => void} props.onNewSession
 * @param {(id: string) => void} props.onDeleteSession
 * @param {(id: string, title: string) => void} props.onRenameSession
 * @param {() => void} props.onCloseDrawer
 */
const SessionList = memo(function SessionList({
  sessions,
  currentSessionId,
  onSessionSelect,
  onNewSession,
  onDeleteSession,
  onRenameSession,
  onCloseDrawer,
}) {
  const navigate = useNavigate();
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const { logout } = useLogout();

  // Context menu state: { sessionId, x, y } or null
  const [contextMenu, setContextMenu] = useState(null);
  const contextMenuRef = useRef(null);

  // Close context menu on any click outside of it
  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    function handleClickOutside(event) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target)) {
        setContextMenu(null);
      }
    }
    // Use a short delay so the opening right-click doesn't immediately close it
    const id = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [contextMenu]);

  // Close context menu on scroll
  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const handleScroll = () => setContextMenu(null);
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [contextMenu]);

  const filtered = useMemo(() => {
    return [...sessions].sort((a, b) => {
      const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
      const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
      return bTime - aTime;
    });
  }, [sessions]);

  const handleContextMenu = useCallback((e, sessionId) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ sessionId, x: e.clientX, y: e.clientY });
  }, []);

  const handleDelete = useCallback(
    (sessionId) => {
      onDeleteSession(sessionId);
      setContextMenu(null);
    },
    [onDeleteSession]
  );

  const startEditing = useCallback((session) => {
    setEditingId(session.id);
    setEditValue(session.title || 'New chat');
    setContextMenu(null);
  }, []);

  const saveEdit = useCallback(
    (sessionId) => {
      if (editValue.trim() && editingId === sessionId) {
        onRenameSession(sessionId, editValue.trim());
      }
      setEditingId(null);
    },
    [editValue, editingId, onRenameSession]
  );

  const handleEditKeyDown = useCallback(
    (e, sessionId) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveEdit(sessionId);
      } else if (e.key === 'Escape') {
        setEditingId(null);
      }
    },
    [saveEdit]
  );

  const handleSessionSelect = useCallback(
    (id) => {
      onSessionSelect(id);
      if (onCloseDrawer && window.innerWidth < 1024) {
        onCloseDrawer();
      }
    },
    [onSessionSelect, onCloseDrawer]
  );

  const handleSetupClick = useCallback(() => {
    navigate('/setup');
    if (onCloseDrawer) {
      onCloseDrawer();
    }
  }, [navigate, onCloseDrawer]);

  const handleLogout = useCallback(() => {
    void logout();
    if (onCloseDrawer) {
      onCloseDrawer();
    }
  }, [logout, onCloseDrawer]);

  // Find the session object for the context menu (needed for "Rename")
  const contextSession = contextMenu ? sessions.find((s) => s.id === contextMenu.sessionId) : null;

  return (
    <div className="sidebar-inner">
      {/* 1. Avatar & System Setup Card */}
      <div className="sidebar-setup-card-wrapper">
        <button
          className="sidebar-setup-card"
          onClick={handleSetupClick}
          aria-label="Avatar and System Setup"
        >
          <div className="setup-card-icon">
            <PiUserGearFill size={20} />
          </div>
          <div className="setup-card-content">
            <span className="setup-card-title">Avatar & System Setup</span>
          </div>
        </button>
      </div>

      {/* 2. Chats Section */}
      <div className="sidebar-chats-section">
        <div className="sidebar-chats-header">
          <h2 className="sidebar-section-title">
            <PiChatsFill /> Chats
          </h2>
          <button className="sidebar-new-chat-btn" onClick={onNewSession} aria-label="New chat">
            <PiPlusFill size={14} /> New Chat
          </button>
        </div>

        <div className="sidebar-sessions-scroll">
          {filtered.length === 0 ? (
            <div className="sidebar-empty-state">
              <p>No chats yet.</p>
            </div>
          ) : (
            filtered.map((session) => {
              const displayTime = session.updated_at || session.created_at;
              const isEditing = editingId === session.id;
              const msgCount = session.message_count || 0;

              return (
                <div
                  key={session.id}
                  className="sidebar-session-item-wrapper"
                  onContextMenu={(e) => handleContextMenu(e, session.id)}
                >
                  <button
                    className={`sidebar-session-item ${session.id === currentSessionId ? 'active' : ''}`}
                    onClick={() => handleSessionSelect(session.id)}
                    aria-label={`Open chat: ${session.title || 'New chat'}`}
                  >
                    <PiChatCircleTextFill className="session-icon" />

                    <div className="session-info">
                      {isEditing ? (
                        <input
                          type="text"
                          className="session-edit-input"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => saveEdit(session.id)}
                          onKeyDown={(e) => handleEditKeyDown(e, session.id)}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <div className="session-title-row">
                          <span className="session-title">{session.title || 'New chat'}</span>
                          {displayTime && (
                            <span className="session-time">{formatTime(displayTime)}</span>
                          )}
                        </div>
                      )}

                      {!isEditing && (
                        <div className="session-preview-row">
                          <span className="session-preview">
                            {msgCount} msg{msgCount !== 1 ? 's' : ''}
                          </span>
                        </div>
                      )}
                    </div>
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="mt-auto px-0 pb-4 pt-4">
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-offwhite/75 transition-colors duration-200 hover:border-red-400/30 hover:bg-red-500/10 hover:text-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60"
            onClick={handleLogout}
            aria-label="Log out of VirtAI"
          >
            <FiLogOut className="h-4 w-4" />
            <span>Log Out</span>
          </button>
        </div>
      </div>

      {/* Floating Context Menu — rendered via portal at cursor position */}
      {contextMenu &&
        contextSession &&
        createPortal(
          <div
            className="session-context-menu"
            ref={contextMenuRef}
            style={{
              position: 'fixed',
              top: contextMenu.y,
              left: contextMenu.x,
              zIndex: 9999,
            }}
          >
            <button className="context-menu-item" onClick={() => startEditing(contextSession)}>
              <PiPencilSimpleFill /> Rename
            </button>
            <div className="context-menu-divider" />
            <button
              className="context-menu-item danger"
              onClick={() => handleDelete(contextMenu.sessionId)}
            >
              <PiTrashSimpleFill /> Delete
            </button>
          </div>,
          document.body
        )}
    </div>
  );
});

export default SessionList;

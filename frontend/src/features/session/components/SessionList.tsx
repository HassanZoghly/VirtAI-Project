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
import { ISession } from '../types';
import SessionHoverPreview from './SessionHoverPreview';

/** Format a timestamp to a short relative / absolute label. */
function formatTime(ts?: string | number): string {
  if (!ts) {
    return '';
  }
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
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

export interface SessionListProps {
  sessions: ISession[];
  currentSessionId: string | null;
  onSessionSelect: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onClearAllSessions?: () => void;
  onCloseDrawer?: () => void;
}

interface SessionListItemProps {
  session: ISession;
  isActive: boolean;
  isEditing: boolean;
  editValue: string;
  onEditValueChange: (val: string) => void;
  onSaveEdit: (id: string) => void;
  onEditKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  onMouseEnter: (session: ISession, element: HTMLElement) => void;
  onMouseLeave: () => void;
  onSelect: (id: string) => void;
}

const SessionListItem = memo(function SessionListItem({
  session,
  isActive,
  isEditing,
  editValue,
  onEditValueChange,
  onSaveEdit,
  onEditKeyDown,
  onContextMenu,
  onMouseEnter,
  onMouseLeave,
  onSelect,
}: SessionListItemProps) {
  const displayTime = session.updated_at || session.created_at;

  return (
    <div
      className="sidebar-session-item-wrapper"
      onContextMenu={(e) => onContextMenu(e, session.id)}
      onMouseEnter={(e) => onMouseEnter(session, e.currentTarget)}
      onMouseLeave={onMouseLeave}
    >
      <button
        className={`sidebar-session-item ${isActive ? 'active' : ''}`}
        onClick={() => onSelect(session.id)}
        aria-label={`Open chat: ${session.title || 'New chat'}`}
      >
        <PiChatCircleTextFill className="session-icon" />

        <div className="session-info">
          {isEditing ? (
            <input
              type="text"
              className="session-edit-input"
              value={editValue}
              onChange={(e) => onEditValueChange(e.target.value)}
              onBlur={() => onSaveEdit(session.id)}
              onKeyDown={(e) => onEditKeyDown(e, session.id)}
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
        </div>
      </button>
    </div>
  );
});

/**
 * Scrollable list of chat sessions with new/rename/delete actions.
 * Right-click a chat item to open the floating context menu.
 */
const SessionList = memo(function SessionList({
  sessions,
  currentSessionId,
  onSessionSelect,
  onNewSession,
  onDeleteSession,
  onRenameSession,
  onClearAllSessions,
  onCloseDrawer,
}: SessionListProps) {
  const navigate = useNavigate();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [hoveredSession, setHoveredSession] = useState<ISession | null>(null);
  const [hoverElement, setHoverElement] = useState<HTMLElement | null>(null);
  const { logout } = useLogout();

  // Context menu state: { sessionId, x, y } or null
  const [contextMenu, setContextMenu] = useState<{
    sessionId: string;
    x: number;
    y: number;
  } | null>(null);
  const [isConfirmClearOpen, setIsConfirmClearOpen] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Close context menu on any click outside of it
  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    function handleClickOutside(event: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null);
      }
    }
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

  // Schwartzian transform: parse each timestamp exactly once, then sort.
  // The previous version called `new Date()` inside the comparator, executing
  // it O(N log N) times on every render — catastrophic for large session lists.

  /** Normalise a session timestamp (string ISO or epoch number) to ms. */
  function toMs(v: string | number | undefined): number {
    if (v === undefined || v === null) return 0;
    return typeof v === 'number' ? v : Date.parse(v) || 0;
  }

  const sortedIds = useMemo(() => {
    // Step 1: compute a numeric timestamp for every session — O(N).
    const tsMap = new Map<string, number>(
      sessions.map((s) => [s.id, toMs(s.updated_at ?? s.created_at)])
    );
    // Step 2: sort by pre-computed value — O(N log N), comparisons are cheap.
    return [...sessions]
      .sort((a, b) => (tsMap.get(b.id) ?? 0) - (tsMap.get(a.id) ?? 0))
      .map((s) => s.id);
  }, [sessions]);

  const filtered = useMemo(() => {
    const sessionMap = new Map(sessions.map((s) => [s.id, s]));
    return sortedIds.map((id) => sessionMap.get(id)).filter(Boolean) as ISession[];
  }, [sortedIds, sessions]);

  const handleContextMenu = useCallback((e: React.MouseEvent, sessionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ sessionId, x: e.clientX, y: e.clientY });
  }, []);

  const handleDelete = useCallback(
    (sessionId: string) => {
      onDeleteSession(sessionId);
      setContextMenu(null);
    },
    [onDeleteSession]
  );

  const startEditing = useCallback((session: ISession) => {
    setEditingId(session.id);
    setEditValue(session.title || 'New chat');
    setContextMenu(null);
  }, []);

  const saveEdit = useCallback(
    (sessionId: string) => {
      if (editValue.trim() && editingId === sessionId) {
        onRenameSession(sessionId, editValue.trim());
      }
      setEditingId(null);
    },
    [editValue, editingId, onRenameSession]
  );

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, sessionId: string) => {
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
    (id: string) => {
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

  const handleItemMouseEnter = useCallback((session: ISession, element: HTMLElement) => {
    setHoveredSession(session);
    setHoverElement(element);
  }, []);

  const handleItemMouseLeave = useCallback(() => {
    setHoveredSession(null);
    setHoverElement(null);
  }, []);

  const contextSession = contextMenu ? sessions.find((s) => s.id === contextMenu.sessionId) : null;

  return (
    <div className="sidebar-inner">
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

      <div className="sidebar-chats-section">
        <div className="sidebar-chats-header">
          <h2 className="sidebar-section-title">
            <PiChatsFill /> Chats
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button className="sidebar-new-chat-btn" onClick={onNewSession} aria-label="New chat">
              <PiPlusFill size={14} /> New Chat
            </button>
            {sessions.length > 0 && (
              <button
                id="clear-all-chats-btn"
                className="sidebar-clear-all-btn"
                onClick={() => setIsConfirmClearOpen(true)}
                aria-label="Delete all chats"
                title="Delete all chats"
              >
                <PiTrashSimpleFill size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="sidebar-sessions-scroll">
          {filtered.length === 0 ? (
            <div className="sidebar-empty-state">
              <p>No chats yet.</p>
            </div>
          ) : (
            filtered.map((session) => {
              const isEditing = editingId === session.id;

              return (
                <SessionListItem
                  key={session.id}
                  session={session}
                  isActive={session.id === currentSessionId}
                  isEditing={isEditing}
                  editValue={isEditing ? editValue : ''}
                  onEditValueChange={setEditValue}
                  onSaveEdit={saveEdit}
                  onEditKeyDown={handleEditKeyDown}
                  onContextMenu={handleContextMenu}
                  onMouseEnter={handleItemMouseEnter}
                  onMouseLeave={handleItemMouseLeave}
                  onSelect={handleSessionSelect}
                />
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

      {isConfirmClearOpen &&
        createPortal(
          <div className="clear-confirm-overlay">
            <div className="clear-confirm-modal">
              <h3 className="clear-confirm-title">Clear all chats?</h3>
              <p className="clear-confirm-desc">This action cannot be undone.</p>
              <div className="clear-confirm-actions">
                <button
                  className="clear-confirm-cancel"
                  onClick={() => setIsConfirmClearOpen(false)}
                >
                  Cancel
                </button>
                <button
                  className="clear-confirm-danger"
                  onClick={() => {
                    setIsConfirmClearOpen(false);
                    onClearAllSessions?.();
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {hoveredSession && hoverElement && (
        <SessionHoverPreview
          session={hoveredSession}
          triggerElement={hoverElement}
          isHovered={!!hoveredSession}
        />
      )}
    </div>
  );
});

export default SessionList;

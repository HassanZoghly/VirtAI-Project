import { memo, useMemo, useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PiChatCircleTextFill,
  PiChatsFill,
  PiPlusFill,
  PiDotsThreeBold,
  PiPencilSimpleFill,
  PiTrashSimpleFill,
  PiUserGearFill
} from 'react-icons/pi';

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
  onCloseDrawer
}) {
  const navigate = useNavigate();
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [contextMenuOpen, setContextMenuOpen] = useState(null);
  
  const contextMenuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target)) {
        setContextMenuOpen(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    return [...sessions].sort((a, b) => {
      const aTime = a.messages?.[a.messages.length - 1]?.timestamp || a.createdAt || 0;
      const bTime = b.messages?.[b.messages.length - 1]?.timestamp || b.createdAt || 0;
      return bTime - aTime;
    });
  }, [sessions]);

  const handleDelete = (e, sessionId) => {
    e.stopPropagation();
    onDeleteSession(sessionId);
    setContextMenuOpen(null);
  };

  const startEditing = (e, session) => {
    e.stopPropagation();
    setEditingId(session.id);
    setEditValue(session.title || 'New chat');
    setContextMenuOpen(null);
  };

  const saveEdit = (sessionId) => {
    if (editValue.trim() && editingId === sessionId) {
      onRenameSession(sessionId, editValue.trim());
    }
    setEditingId(null);
  };

  const handleEditKeyDown = (e, sessionId) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit(sessionId);
    } else if (e.key === 'Escape') {
      setEditingId(null);
    }
  };

  const handleSessionSelect = (id) => {
    onSessionSelect(id);
    if (onCloseDrawer && window.innerWidth < 1024) {
      onCloseDrawer();
    }
  };

  const handleSetupClick = () => {
    navigate('/setup');
    if (onCloseDrawer) onCloseDrawer();
  };

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
          <h3 className="sidebar-section-title">
            <PiChatsFill /> Chats
          </h3>
          <button
            className="sidebar-new-chat-btn"
            onClick={onNewSession}
            aria-label="New chat"
          >
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
              const lastMsg = session.messages?.[session.messages.length - 1];
              const displayTime = lastMsg?.timestamp || session.createdAt;
              const isEditing = editingId === session.id;

              return (
                <div key={session.id} className="sidebar-session-item-wrapper">
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
                          {displayTime && <span className="session-time">{formatTime(displayTime)}</span>}
                        </div>
                      )}
                      
                      {!isEditing && (
                        <div className="session-preview-row">
                          <span className="session-preview">
                            {lastMsg ? lastMsg.content : `${session.messages?.length || 0} msg`}
                          </span>
                        </div>
                      )}
                    </div>
                  </button>

                  {!isEditing && (
                    <div className="session-more-menu-container">
                      <button
                        className={`session-more-btn ${contextMenuOpen === session.id ? 'active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setContextMenuOpen(contextMenuOpen === session.id ? null : session.id);
                        }}
                        aria-label="More options"
                      >
                        <PiDotsThreeBold />
                      </button>

                      {contextMenuOpen === session.id && (
                        <div className="session-context-menu" ref={contextMenuRef}>
                          <button 
                            className="context-menu-item"
                            onClick={(e) => startEditing(e, session)}
                          >
                            <PiPencilSimpleFill /> Rename
                          </button>
                          <div className="context-menu-divider" />
                          <button 
                            className="context-menu-item danger"
                            onClick={(e) => handleDelete(e, session.id)}
                          >
                            <PiTrashSimpleFill /> Delete
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
});

export default SessionList;

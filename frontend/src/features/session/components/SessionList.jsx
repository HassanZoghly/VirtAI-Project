import { memo, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PiChatCircleTextFill,
  PiChatsFill,
  PiMagnifyingGlassFill,
  PiPencilFill,
  PiPlusFill,
  PiTrashFill,
  PiTrayFill,
  PiSlidersHorizontalFill,
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
    return `${diffMin}m ago`;
  }
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) {
    return `${diffH}h ago`;
  }
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) {
    return `${diffD}d ago`;
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Scrollable list of chat sessions with new/rename/delete actions.
 * Shows timestamps, message counts, search filter (10+ sessions), and delete confirmation.
 * @param {object} props
 * @param {{ id: string, title: string, messages: any[], createdAt?: number }[]} props.sessions
 * @param {string} props.currentSessionId
 * @param {(id: string) => void} props.onSessionSelect
 * @param {() => void} props.onNewSession
 * @param {(id: string) => void} props.onDeleteSession
 * @param {(id: string, title: string) => void} props.onRenameSession
 */
const SessionList = memo(function SessionList({
  sessions,
  currentSessionId,
  onSessionSelect,
  onNewSession,
  onDeleteSession,
  onRenameSession,
}) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');

  const showSearch = sessions.length >= 10;

  const filtered = useMemo(() => {
    // Sort newest to oldest based on latest activity
    const sorted = [...sessions].sort((a, b) => {
      const aTime = a.messages?.[a.messages.length - 1]?.timestamp || a.createdAt || 0;
      const bTime = b.messages?.[b.messages.length - 1]?.timestamp || b.createdAt || 0;
      return bTime - aTime;
    });

    if (!searchQuery.trim()) {
      return sorted;
    }
    const q = searchQuery.toLowerCase();
    return sorted.filter((s) => (s.title || '').toLowerCase().includes(q));
  }, [sessions, searchQuery]);

  const handleDelete = (e, sessionId) => {
    e.stopPropagation();
    if (confirmDeleteId === sessionId) {
      onDeleteSession(sessionId);
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(sessionId);
    }
  };

  // Reset confirmation when clicking elsewhere
  const handleWrapperClick = () => {
    if (confirmDeleteId) {
      setConfirmDeleteId(null);
    }
  };

  const startEditing = (e, session) => {
    e.stopPropagation();
    setEditingId(session.id);
    setEditValue(session.title || 'New chat');
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

  return (
    <div className="drawer-section sessions-section" onClick={handleWrapperClick}>
      {/* 1. Edit Setup Settings */}
      <button 
        className="edit-setup-btn" 
        onClick={() => navigate('/setup')}
        aria-label="Edit Setup Settings"
      >
        <PiSlidersHorizontalFill className="edit-setup-icon" />
        <div className="edit-setup-text">
          <span className="edit-setup-title">Edit Setup Settings</span>
          <span className="edit-setup-desc">Change avatar or voice</span>
        </div>
      </button>

      {/* 2. Chats Section Header */}
      <div className="section-header mt-6">
        <h3 className="drawer-section-title mb-0">
          <PiChatsFill /> Chats
        </h3>
        <button
          className="new-chat-btn"
          onClick={onNewSession}
          aria-label="New chat"
        >
          <PiPlusFill /> New Chat
        </button>
      </div>

      {showSearch && (
        <div className="session-search">
          <PiMagnifyingGlassFill className="session-search-icon" />
          <input
            type="text"
            className="session-search-input"
            placeholder="Search chats…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search chats"
          />
        </div>
      )}

      <div className="sessions-scroll">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <PiTrayFill />
            <p>{searchQuery ? 'No matching chats' : 'No chats yet. Start a new conversation.'}</p>
          </div>
        ) : (
          filtered.map((session) => {
            const lastMsg = session.messages?.[session.messages.length - 1];
            const displayTime = lastMsg?.timestamp || session.createdAt;

            return (
              <div key={session.id} className="session-item-wrapper">
                <button
                  className={`session-item ${session.id === currentSessionId ? 'active' : ''}`}
                  onClick={() => onSessionSelect(session.id)}
                  aria-label={`Open chat: ${session.title || 'New chat'}`}
                >
                  <PiChatCircleTextFill className="session-icon" />
                  <div className="session-info">
                    {editingId === session.id ? (
                      <input
                        type="text"
                        className="session-edit-input"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => saveEdit(session.id)}
                        onKeyDown={(e) => handleEditKeyDown(e, session.id)}
                        autoFocus
                        aria-label="Rename chat"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="session-title">{session.title || 'New chat'}</span>
                    )}
                    <span className="session-meta">
                      {lastMsg ? (
                        <span className="session-preview">{lastMsg.content}</span>
                      ) : (
                        <span className="session-preview">{session.messages?.length || 0} msg</span>
                      )}
                      <span className="session-time">
                        {displayTime ? ` · ${formatTime(displayTime)}` : ''}
                      </span>
                    </span>
                  </div>
                </button>
                <div className="session-actions">
                  <button
                    className="session-action-btn"
                    onClick={(e) => startEditing(e, session)}
                    aria-label="Rename chat"
                    title="Rename"
                  >
                    <PiPencilFill />
                  </button>
                  <button
                    className={`session-action-btn delete${confirmDeleteId === session.id ? ' confirm' : ''}`}
                    onClick={(e) => handleDelete(e, session.id)}
                    aria-label={confirmDeleteId === session.id ? 'Confirm delete' : 'Delete chat'}
                    title={confirmDeleteId === session.id ? 'Click again to delete' : 'Delete'}
                  >
                    <PiTrashFill />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});

export default SessionList;

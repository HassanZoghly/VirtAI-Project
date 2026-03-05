import { memo, useMemo, useState } from 'react';
import {
  PiChatsFill,
  PiPlusCircleFill,
  PiChatCircleTextFill,
  PiPencilFill,
  PiTrashFill,
  PiTrayFill,
  PiMagnifyingGlassFill,
} from 'react-icons/pi';

/** Format a timestamp to a short relative / absolute label. */
function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
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
 * @param {(id: string) => void} props.onRenameClick
 */
const SessionList = memo(function SessionList({
  sessions,
  currentSessionId,
  onSessionSelect,
  onNewSession,
  onDeleteSession,
  onRenameClick,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const showSearch = sessions.length >= 10;

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase();
    return sessions.filter((s) => (s.title || '').toLowerCase().includes(q));
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
    if (confirmDeleteId) setConfirmDeleteId(null);
  };

  return (
    <div className="drawer-section sessions-section" onClick={handleWrapperClick}>
      <div className="section-header">
        <h3 className="drawer-section-title">
          <PiChatsFill /> Chats
        </h3>
        <button
          className="new-session-btn"
          onClick={onNewSession}
          aria-label="New chat"
          title="New chat"
        >
          <PiPlusCircleFill />
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
            <p>{searchQuery ? 'No matching chats' : 'No chats yet'}</p>
          </div>
        ) : (
          filtered.map((session) => (
            <div key={session.id} className="session-item-wrapper">
              <button
                className={`session-item ${session.id === currentSessionId ? 'active' : ''}`}
                onClick={() => onSessionSelect(session.id)}
              >
                <PiChatCircleTextFill className="session-icon" />
                <div className="session-info">
                  <span className="session-title">{session.title || 'New chat'}</span>
                  <span className="session-meta">
                    {session.messages?.length || 0} msg
                    {session.createdAt ? ` · ${formatTime(session.createdAt)}` : ''}
                  </span>
                </div>
              </button>
              <div className="session-actions">
                <button
                  className="session-action-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRenameClick(session.id);
                  }}
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
          ))
        )}
      </div>
    </div>
  );
});

export default SessionList;

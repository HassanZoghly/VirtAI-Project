import { lazy, Suspense, useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  PiGearFill,
  PiXFill,
  PiClockFill,
  PiTrayFill,
  PiPaperclipFill,
  PiMicrophoneFill,
  PiPaperPlaneTiltFill,
  PiRobotFill,
  PiUserCircleFill,
  PiWifiSlashFill,
  PiWarningCircleFill,
  PiChatTeardropTextFill,
  PiSlidersHorizontalFill,
  PiChatCircleTextFill,
  PiPlusCircleFill,
  PiChatsFill,
  PiPencilFill,
  PiTrashFill,
} from 'react-icons/pi';
import { getAvatarById } from '../../../data/avatars';
import Toast from '../../../utils/toast';
import CopyButton from './CopyButton';
import useWSClient from '../../../hooks/useWSClient';
import useConversationReducer from '../../../hooks/useConversationReducer';

const toast = new Toast('tr');

const AvatarController = lazy(() => import('./AvatarController.jsx'));

const AVATAR_MODEL_PATH = '/models/avatar1.glb';

function RenameModal({ isOpen, sessionTitle, onConfirm, onCancel }) {
  const [inputValue, setInputValue] = useState(sessionTitle || '');
  useEffect(() => {
    setInputValue(sessionTitle || '');
  }, [sessionTitle]);
  if (!isOpen) {
    return null;
  }
  const handleSubmit = (e) => {
    e.preventDefault();
    if (inputValue.trim()) {
      onConfirm(inputValue.trim());
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Rename chat</h3>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            className="modal-input"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Enter new chat name"
            autoFocus
          />
          <div className="modal-actions">
            <button type="button" className="modal-btn cancel" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="modal-btn confirm">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SessionList({
  sessions,
  currentSessionId,
  onSessionSelect,
  onNewSession,
  onDeleteSession,
  onRenameClick,
}) {
  return (
    <div className="drawer-section sessions-section">
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

      <div className="sessions-scroll">
        {sessions.length === 0 ? (
          <div className="empty-state">
            <PiTrayFill />
            <p>No chats yet</p>
          </div>
        ) : (
          sessions.map((session) => (
            <div key={session.id} className="session-item-wrapper">
              <button
                className={`session-item ${session.id === currentSessionId ? 'active' : ''}`}
                onClick={() => onSessionSelect(session.id)}
              >
                <PiChatCircleTextFill className="session-icon" />
                <span className="session-title">{session.title || 'New chat'}</span>
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
                  className="session-action-btn delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSession(session.id);
                  }}
                  aria-label="Delete chat"
                  title="Delete"
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
}

export default function ClassroomShell() {
  // WebSocket connection
  const WS_URL = 'ws://localhost:8000/api/v1/ws/avatar1';
  const { isConnected, send, onMessage } = useWSClient(WS_URL);

  // Conversation state management
  const [conversationState, dispatch] = useConversationReducer();

  // Avatar state
  const [audioUrl, setAudioUrl] = useState(null);
  const [mouthCues, setMouthCues] = useState([]);

  const [sessions, setSessions] = useState(() => {
    const defaultSession = {
      id: Date.now().toString(),
      title: 'New chat',
      messages: [],
    };
    return [defaultSession];
  });
  const [currentSessionId, setCurrentSessionId] = useState(sessions[0].id);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [avatarLoaded, setAvatarLoaded] = useState(false);
  const [backendStatus, setBackendStatus] = useState('checking');
  const [avatarError, setAvatarError] = useState(false);

  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [sessionToRename, setSessionToRename] = useState(null);

  const messagesEndRef = useRef(null);
  const chatScrollRef = useRef(null);
  const shouldStickToBottom = useRef(true);
  const textareaRef = useRef(null);

  // Register WebSocket message handlers
  useEffect(() => {
    // Handle streaming tokens
    const unsubDelta = onMessage('chat.delta', (data) => {
      dispatch({ type: 'CHAT_DELTA', payload: data });
    });

    // Handle final response
    const unsubFinal = onMessage('chat.final', (data) => {
      dispatch({ type: 'CHAT_FINAL', payload: data });
      // Update session with final message
      // Generate unique ID for assistant message (backend message_id is for the user's message)
      const assistantMessageId = `${data.message_id}-assistant`;
      setSessions((prevSessions) =>
        prevSessions.map((session) =>
          session.id === currentSessionId
            ? {
              ...session,
              messages: [
                ...session.messages,
                {
                  id: assistantMessageId,
                  role: 'assistant',
                  content: data.text,
                  timestamp: Date.now(),
                },
              ],
            }
            : session
        )
      );
    });

    // Handle pipeline state changes
    const unsubPipeline = onMessage('pipeline.state', (data) => {
      dispatch({ type: 'PIPELINE_STATE', payload: data });
    });

    // Handle TTS audio ready
    const unsubTTS = onMessage('tts.ready', (data) => {
      setAudioUrl(data.audio.url);
    });

    // Handle visemes ready
    const unsubVisemes = onMessage('visemes.ready', (data) => {
      setMouthCues(data.mouthCues);
    });

    // Handle errors
    const unsubError = onMessage('error', (data) => {
      dispatch({ type: 'ERROR', payload: data });
      toast.show('error', 'Error', data.message || 'An error occurred', 5000);
    });

    // Cleanup handlers on unmount
    return () => {
      if (unsubDelta) {
        unsubDelta();
      }
      if (unsubFinal) {
        unsubFinal();
      }
      if (unsubPipeline) {
        unsubPipeline();
      }
      if (unsubTTS) {
        unsubTTS();
      }
      if (unsubVisemes) {
        unsubVisemes();
      }
      if (unsubError) {
        unsubError();
      }
    };
  }, [onMessage, dispatch, currentSessionId]);

  // Update backend status based on WebSocket connection
  useEffect(() => {
    setBackendStatus(isConnected ? 'online' : 'offline');
  }, [isConnected]);

  // Load avatar data from localStorage (memoized)
  const avatarData = useMemo(() => {
    try {
      const saved = localStorage.getItem('virtai-settings');
      if (!saved) {
        return null;
      }
      const settings = JSON.parse(saved);
      return settings?.character ? getAvatarById(settings.character) : null;
    } catch {
      console.warn('Failed to parse settings');
      return null;
    }
  }, []);

  const currentSession = useMemo(
    () => sessions.find((s) => s.id === currentSessionId) || sessions[0],
    [sessions, currentSessionId]
  );

  const handleAvatarError = useCallback(() => {
    setAvatarError(true);
  }, []);

  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) {
      return;
    }
    shouldStickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 120;
  }, []);

  useEffect(() => {
    if (!shouldStickToBottom.current) {
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [currentSession.messages, conversationState.currentMessage]);

  const createNewSession = useCallback(() => {
    const newSession = {
      id: Date.now().toString(),
      title: 'New chat',
      messages: [],
    };
    setSessions((prev) => [...prev, newSession]);
    setCurrentSessionId(newSession.id);
  }, []);

  const switchSession = useCallback((sessionId) => {
    setCurrentSessionId(sessionId);
  }, []);

  const deleteSession = useCallback(
    (sessionId) => {
      setSessions((prev) => {
        const newSessions = prev.filter((s) => s.id !== sessionId);
        if (newSessions.length === 0) {
          const newSession = {
            id: Date.now().toString(),
            title: 'New chat',
            messages: [],
          };
          return [newSession];
        }
        if (sessionId === currentSessionId) {
          setCurrentSessionId(newSessions[0].id);
        }
        return newSessions;
      });
    },
    [currentSessionId]
  );

  const openRenameModal = useCallback(
    (sessionId) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (session) {
        setSessionToRename(session);
        setIsRenameModalOpen(true);
      }
    },
    [sessions]
  );

  const handleRenameConfirm = useCallback(
    (newTitle) => {
      if (sessionToRename) {
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionToRename.id ? { ...s, title: newTitle } : s))
        );
        setIsRenameModalOpen(false);
        setSessionToRename(null);
      }
    },
    [sessionToRename]
  );

  const handleRenameCancel = useCallback(() => {
    setIsRenameModalOpen(false);
    setSessionToRename(null);
  }, []);

  const handleSendMessage = useCallback(() => {
    const text = inputValue.trim();
    if (!text) {
      return;
    }

    // Generate unique message ID
    const message_id = crypto.randomUUID();

    const newMessage = {
      id: message_id,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    // Dispatch USER_MESSAGE action to conversation state
    dispatch({
      type: 'USER_MESSAGE',
      payload: { message_id, text },
    });

    // Update local session state
    setSessions((prevSessions) =>
      prevSessions.map((session) =>
        session.id === currentSessionId
          ? {
            ...session,
            messages: [...session.messages, newMessage],
            title:
              session.messages.length === 0
                ? text.slice(0, 30) + (text.length > 30 ? '…' : '')
                : session.title,
          }
          : session
      )
    );

    // Send message via WebSocket
    send({
      type: 'chat.user_message',
      data: {
        message_id,
        text,
      },
    });

    setInputValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    if (!isConnected) {
      toast.show('warning', 'Offline', 'Message queued. Will send when connected.', 3000);
    }
  }, [inputValue, currentSessionId, isConnected, send, dispatch]);

  const onKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    },
    [handleSendMessage]
  );

  const avatarName = avatarData?.name || 'AI Tutor';
  const statusBadgeClass =
    backendStatus === 'offline'
      ? 'offline'
      : backendStatus === 'checking'
        ? 'connecting'
        : 'online';
  const statusLabel =
    backendStatus === 'offline'
      ? `${avatarName} — Offline`
      : backendStatus === 'checking'
        ? 'Connecting…'
        : `${avatarName} Online`;

  return (
    <div className="classroom-shell">
      {isSettingsOpen && (
        <div className="settings-drawer open">
          <div className="drawer-overlay" onClick={() => setIsSettingsOpen(false)} />
          <div className="drawer-content">
            <div className="drawer-header">
              <div className="drawer-title-group">
                <PiSlidersHorizontalFill className="drawer-title-icon" />
                <h2 className="drawer-title">Settings</h2>
              </div>
              <button
                className="drawer-close"
                onClick={() => setIsSettingsOpen(false)}
                aria-label="Close settings"
              >
                <PiXFill />
              </button>
            </div>

            <div className="drawer-body">
              <SessionList
                sessions={sessions}
                currentSessionId={currentSessionId}
                onSessionSelect={switchSession}
                onNewSession={createNewSession}
                onDeleteSession={deleteSession}
                onRenameClick={openRenameModal}
              />

              <div className="drawer-section">
                <h3 className="drawer-section-title">
                  <PiClockFill /> Current Session
                </h3>
                {currentSession.messages.filter((m) => m.role === 'user').length > 0 ? (
                  <div className="drawer-info-row">
                    <PiChatCircleTextFill className="drawer-info-icon" />
                    <span className="drawer-info-label">Messages</span>
                    <span className="drawer-info-value">
                      {currentSession.messages.filter((m) => m.role === 'user').length}
                    </span>
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
                    style={{ color: backendStatus === 'offline' ? '#ef4444' : 'var(--success)' }}
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
      )}

      <button
        className="avatar-settings-btn"
        onClick={() => setIsSettingsOpen(true)}
        title="Settings"
      >
        <PiGearFill />
      </button>

      <div className={`avatar-status-badge ${statusBadgeClass}`}>
        {backendStatus === 'offline' ? (
          <PiWifiSlashFill className="status-icon-offline" />
        ) : (
          <span
            className={`status-dot${backendStatus === 'checking' ? ' status-dot-connecting' : ''}`}
          />
        )}
        <span className="status-text">{statusLabel}</span>
      </div>

      <div className="split-container">
        {/* Avatar Panel */}
        <div className="avatar-panel" style={{ background: avatarLoaded ? '#333' : '' }}>
          {/* Loader */}
          {!avatarLoaded && !avatarError && (
            <div className="avatar-loader-container">
              <div className="avatar-loader">
                <div className="avatar-loader-fill" />
              </div>
            </div>
          )}

          {/* Avatar Canvas */}
          <div className="avatar-canvas-wrapper visible">
            <Suspense fallback={null}>
              <AvatarController
                modelPath={AVATAR_MODEL_PATH}
                pipelineState={conversationState.pipelineState}
                audioUrl={audioUrl}
                mouthCues={mouthCues}
                onModelLoaded={() => setAvatarLoaded(true)}
                onError={handleAvatarError}
              />
            </Suspense>
          </div>
        </div>

        {/* Chat Panel */}
        <div className="chat-panel">
          <div className="chat-messages" ref={chatScrollRef} onScroll={handleChatScroll}>
            {currentSession.messages.length === 0 ? (
              <div className="welcome-state">
                <PiChatTeardropTextFill className="welcome-icon" />
                <h2 className="welcome-title">Start a conversation</h2>
                <p className="welcome-subtitle">Ask {avatarName} anything to begin your lesson.</p>
              </div>
            ) : (
              <div className="chat-stream">
                {currentSession.messages.map((msg) => {
                  const isUser = msg.role === 'user';
                  return (
                    <div
                      key={msg.id}
                      className={`chat-message-wrapper ${isUser ? 'user-message-wrapper' : 'ai-message-wrapper'
                        }`}
                    >
                      <div className={`chat-message ${isUser ? 'user-message' : 'ai-message'}`}>
                        {!isUser && (
                          <div className="message-avatar">
                            <PiRobotFill />
                          </div>
                        )}
                        <div className="message-bubble">
                          {msg.content}
                          {!isUser && <CopyButton content={msg.content} />}
                        </div>
                        {isUser && (
                          <div className="message-avatar">
                            <PiUserCircleFill />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {/* Show streaming message if present */}
                {conversationState.currentMessage && (
                  <div className="chat-message-wrapper ai-message-wrapper">
                    <div className="chat-message ai-message">
                      <div className="message-avatar">
                        <PiRobotFill />
                      </div>
                      <div className="message-bubble">
                        {conversationState.currentMessage}
                        <span className="streaming-cursor">▊</span>
                      </div>
                    </div>
                  </div>
                )}
                {/* Show error message if present */}
                {conversationState.error && (
                  <div className="chat-message-wrapper ai-message-wrapper">
                    <div className="chat-message ai-message error-message">
                      <div className="message-avatar">
                        <PiWarningCircleFill />
                      </div>
                      <div className="message-bubble">
                        <strong>Error:</strong> {conversationState.error}
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          <div className="chat-input-bar">
            <button className="input-icon-btn" title="Attach file" type="button" disabled>
              <PiPaperclipFill />
            </button>
            <button className="input-icon-btn" title="Voice input" type="button" disabled>
              <PiMicrophoneFill />
            </button>

            <textarea
              ref={textareaRef}
              className="chat-input"
              placeholder={
                backendStatus === 'offline' ? 'Type a message (offline mode)…' : 'Type a message…'
              }
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onKeyDown={onKeyDown}
              rows={1}
            />

            <button
              className="send-btn"
              onClick={handleSendMessage}
              title="Send message"
              type="button"
              disabled={!inputValue.trim()}
              style={{ opacity: inputValue.trim() ? 1 : 0.5 }}
            >
              <PiPaperPlaneTiltFill />
            </button>
          </div>
        </div>
      </div>

      <RenameModal
        isOpen={isRenameModalOpen}
        sessionTitle={sessionToRename?.title || ''}
        onConfirm={handleRenameConfirm}
        onCancel={handleRenameCancel}
      />
    </div>
  );
}

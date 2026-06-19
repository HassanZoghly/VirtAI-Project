// Avatar imports removed
import { ChatInput, MessageList } from '@/features/chat';
import { SettingsDrawer, useSessionManager } from '@/features/session';
import { DocumentsDrawer } from '@/features/documents/components/DocumentsDrawer';
import { loadSetup } from '@/features/setup';
import useConversationReducer from '@/features/chat/hooks/useConversationReducer';
import useWSClient, { ConnectionState } from '@/core/realtime/useWSClient';
import { toast } from '@/shared/utils/toast';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { PiGearFill, PiWifiSlashFill } from 'react-icons/pi';
import { useNavigate, useParams } from 'react-router-dom';
import { SCROLL_STICK_THRESHOLD_PX } from './constants';
const SETUP_STORAGE_KEYS = ['virtai-setup', 'virtai:setup', 'setupConfig', 'setup'];

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function normalizeSetupConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object') {
    return {};
  }

  const sources = [
    rawConfig,
    rawConfig.setup,
    rawConfig.setupConfig,
    rawConfig.classroomSetup,
    rawConfig.preferences,
  ].filter((source) => source && typeof source === 'object');

  const avatarId = firstString(
    ...sources.flatMap((source) => [
      source.avatarId,
      source.avatar_id,
      source.avatar?.id,
      source.selectedAvatar?.id,
    ])
  );
  const voiceId = firstString(
    ...sources.flatMap((source) => [
      source.voiceId,
      source.voice_id,
      source.ttsVoiceId,
      source.tts_voice_id,
      source.voice?.id,
      source.selectedVoice?.id,
    ])
  );
  const movementSource = sources.find(
    (source) =>
      typeof source.movementEnabled === 'boolean' || typeof source.movement_enabled === 'boolean'
  );

  return {
    ...rawConfig,
    ...(avatarId ? { avatarId } : {}),
    ...(voiceId ? { voiceId } : {}),
    ...(movementSource
      ? { movementEnabled: movementSource.movementEnabled ?? movementSource.movement_enabled }
      : {}),
  };
}

function hasSetupSelection(config) {
  return !!config.avatarId || !!config.voiceId || typeof config.movementEnabled === 'boolean';
}

function readSetupStorageKey(key) {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function loadClassroomSetup() {
  const primary = normalizeSetupConfig(loadSetup());
  if (hasSetupSelection(primary)) {
    return primary;
  }

  for (const key of SETUP_STORAGE_KEYS) {
    const fallback = normalizeSetupConfig(readSetupStorageKey(key));
    if (hasSetupSelection(fallback)) {
      return fallback;
    }
  }

  return primary;
}

function getDefaultVoiceId(avatarId) {
  return getAvatarById(avatarId)?.gender === 'female' ? 'aria' : 'guy';
}

function buildWsUrl(avatarId, voiceId, sessionId) {
  const configuredBase = import.meta.env.VITE_WS_BASE_URL;
  const base =
    configuredBase ||
    `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`;
  const url = new URL(`/api/v1/ws/${avatarId}`, base);
  url.searchParams.set('voice', voiceId);
  url.searchParams.set('session_id', sessionId);
  return url.toString();
}

export default function ClassroomShell() {
  const { sessionId: urlSessionId } = useParams();
  const navigate = useNavigate();

  const [setupConfig] = useState(loadClassroomSetup);
  const activeAvatarId = setupConfig.avatarId || 'omar';
  const activeVoiceId = setupConfig.voiceId || getDefaultVoiceId(activeAvatarId);
  const movementEnabled = setupConfig.movementEnabled ?? false;
  const wsAvatarId = activeAvatarId;

  const [conversationState, dispatch] = useConversationReducer();
  const session = useSessionManager(urlSessionId, navigate);

  // Avatar UI temporarily decoupled

  const sessionList = session.sessions;
  const currentSessionId = session.currentSessionId;
  const currentSession = session.currentSession;
  const status = session.status;
  const createNewSession = session.createNewSession;
  const switchSession = session.switchSession;
  const deleteSession = session.deleteSession;
  const clearAllSessions = session.clearAllSessions;
  const renameSession = session.renameSession;

  const WS_URL =
    status === 'success' && currentSessionId
      ? buildWsUrl(wsAvatarId, activeVoiceId, currentSessionId)
      : null;

  const { connectionState, isConnected, send, onMessage, reconnect, reconnectError } =
    useWSClient(WS_URL);

  const [audioUrl, setAudioUrl] = useState(null);
  const [audioItems, setAudioItems] = useState([]);
  const [audioQueueResetToken, setAudioQueueResetToken] = useState(0);
  const [mouthCues, setMouthCues] = useState([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDocumentsOpen, setIsDocumentsOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const isSidebarOpen = isSettingsOpen || isDocumentsOpen;
  const [interimTranscript, setInterimTranscript] = useState('');

  const messagesEndRef = useRef(null);
  const chatScrollRef = useRef(null);
  const shouldStickToBottom = useRef(true);
  const textareaRef = useRef(null);
  const scrollPositionsRef = useRef(new Map());
  const prevSessionIdRef = useRef(currentSessionId);

  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const resetAvatarAudio = useCallback(() => {
    setAudioUrl(null);
    setAudioItems([]);
    setAudioQueueResetToken((token) => token + 1);
  }, []);

  const ensureSessionAndSend = useCallback(
    async (sendAction) => {
      let activeId = currentSessionId;
      if (!activeId) {
        toast.info('Starting chat', 'Initializing conversation...', 2000);
        activeId = await createNewSession();
        if (!activeId) {
          toast.error('Error', 'Failed to initialize session');
          return;
        }
      }
      sendAction(activeId);
    },
    [currentSessionId, createNewSession]
  );

  const commitAndSend = useCallback(
    (text) => {
      ensureSessionAndSend(() => {
        const message_id = crypto.randomUUID();
        resetAvatarAudio();
        dispatch({ type: 'USER_MESSAGE', payload: { message_id, text } });
        dispatch({ type: 'PIPELINE_STATE', payload: { state: 'thinking' } });
        sessionRef.current.addUserMessage(
          { id: message_id, role: 'user', content: text, timestamp: Date.now() },
          text
        );
        send({ type: 'chat.user_message', data: { message_id, text } });
      });
    },
    [dispatch, send, ensureSessionAndSend, resetAvatarAudio]
  );

  const safeSend = useCallback(
    (message) => {
      ensureSessionAndSend(() => send(message));
    },
    [ensureSessionAndSend, send]
  );

  // Save / restore scroll position on session switch
  useEffect(() => {
    const prevId = prevSessionIdRef.current;
    const nextId = currentSessionId;
    if (prevId !== nextId) {
      // EXPLICIT MEDIA HALT: clear media state to force AvatarController to pause and unmount audio
      resetAvatarAudio();
      setMouthCues([]);

      if (chatScrollRef.current) {
        scrollPositionsRef.current.set(prevId, chatScrollRef.current.scrollTop);
      }
      requestAnimationFrame(() => {
        const saved = scrollPositionsRef.current.get(nextId);
        if (chatScrollRef.current && saved !== null && saved !== undefined) {
          chatScrollRef.current.scrollTop = saved;
          shouldStickToBottom.current = false;
        } else {
          shouldStickToBottom.current = true;
        }
      });
      prevSessionIdRef.current = nextId;
    }
  }, [currentSessionId, resetAvatarAudio]);

  // WebSocket message subscriptions
  useEffect(() => {
    const unsubs = [
      onMessage('user.message.echo', (d) => {
        if (!d?.message_id || !d?.text) {
          return;
        }
        dispatch({ type: 'USER_MESSAGE', payload: { message_id: d.message_id, text: d.text } });
        sessionRef.current.addUserMessage(
          { id: d.message_id, role: 'user', content: d.text, timestamp: Date.now() },
          d.text
        );
      }),
      onMessage('chat.delta', (d) => {
        if (d.delta) d.delta = d.delta.replace(/\[.*?\]/g, '');
        dispatch({ type: 'CHAT_DELTA', payload: d });
      }),
      onMessage('chat.final', (d) => {
        if (d.text) d.text = d.text.replace(/\[.*?\]/g, '');
        dispatch({ type: 'CHAT_FINAL', payload: d });
        sessionRef.current.addAssistantMessage(`${d.message_id}-assistant`, d.text);
      }),
      onMessage('pipeline.state', (d) => dispatch({ type: 'PIPELINE_STATE', payload: d })),
      onMessage('animation.timeline.v2', () => { /* Handled internally by audio sync */ }),
      onMessage('tts.ready', (d) => {
        const url = d?.audio?.url;
        if (!url) {
          return;
        }

        setAudioUrl(url);
        setAudioItems((prev) => [
          ...prev,
          {
            id: d.message_id ? `${d.message_id}:${url}` : `${Date.now()}-${prev.length}`,
            messageId: d.message_id || null,
            url,
            durationMs: Number.isFinite(d.audio?.duration_ms) ? d.audio.duration_ms : null,
          },
        ]);
      }),
      onMessage('visemes.ready', (d) => setMouthCues(d.mouthCues)),
      onMessage('error', (d) => {
        dispatch({ type: 'ERROR', payload: d });
        toast.error('Error', d.message || 'An error occurred', 5000);
      }),
      onMessage('transcript', (d) => {
        if (d.is_final) {
          setInterimTranscript('');
        } else {
          setInterimTranscript(d.text || '');
        }
      }),
    ];
    return () => unsubs.forEach((fn) => fn?.());
  }, [onMessage, dispatch, send, commitAndSend]);

  const avatarName = 'AI Tutor';

  const openSettings = useCallback(() => setIsSettingsOpen(true), []);
  const closeSettings = useCallback(() => setIsSettingsOpen(false), []);
  const toggleDocuments = useCallback(() => setIsDocumentsOpen((prev) => !prev), []);

  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) {
      return;
    }
    shouldStickToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_STICK_THRESHOLD_PX;
  }, []);

  useEffect(() => {
    if (!shouldStickToBottom.current) {
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentSession?.messages, conversationState.currentMessage, interimTranscript]);

  const handleSendMessage = useCallback(() => {
    const text = inputValue.trim();
    if (!text) {
      return;
    }
    commitAndSend(text);

    setInputValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    if (!isConnected) {
      toast.warning('Offline', 'Message queued. Will send when connected.', 3000);
    }
  }, [inputValue, isConnected, commitAndSend]);

  const onKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    },
    [handleSendMessage]
  );


  const statusBadgeClass =
    {
      [ConnectionState.OFFLINE]: 'offline',
      [ConnectionState.RECONNECTING]: 'reconnecting',
      [ConnectionState.INITIALIZING]: 'initializing',
      [ConnectionState.ONLINE]: 'online',
    }[connectionState] || 'offline';

  const statusLabel =
    reconnectError ||
    {
      [ConnectionState.OFFLINE]: `${avatarName} — Offline`,
      [ConnectionState.RECONNECTING]: 'Reconnecting…',
      [ConnectionState.INITIALIZING]: 'Starting up…',
      [ConnectionState.ONLINE]: `${avatarName} Online`,
    }[connectionState] ||
    `${avatarName} — Offline`;

  if (status === 'error') {
    return (
      <div
        className="classroom-error"
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          color: '#ff6b6b',
          fontSize: '1.2rem',
        }}
      >
        Failed to load sessions. Please refresh the page.
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>{avatarName} — VirtAI Classroom</title>
      </Helmet>
      <div className="classroom-shell">
        <h1
          className="classroom-watermark"
          style={{
            position: 'absolute',
            bottom: '1.5rem',
            left: '1.5rem',
            fontSize: 'var(--h1)',
            fontWeight: '700',
            letterSpacing: '-0.02em',
            color: 'var(--text-primary)',
            opacity: 0.05,
            pointerEvents: 'none',
            zIndex: 10,
            margin: 0,
          }}
        >
          VirtAI
        </h1>
        <SettingsDrawer
          isOpen={isSettingsOpen}
          onClose={closeSettings}
          sessions={sessionList}
          currentSessionId={currentSessionId}
          onSessionSelect={switchSession}
          onNewSession={createNewSession}
          onDeleteSession={deleteSession}
          onRenameSession={renameSession}
          onClearAllSessions={clearAllSessions}
        />
        <DocumentsDrawer isOpen={isDocumentsOpen} onClose={() => setIsDocumentsOpen(false)} sessionId={currentSessionId} />

        <div className="classroom-top-controls">
          <button
            className="avatar-settings-btn"
            onClick={openSettings}
            title="Settings"
            aria-label="Open settings"
          >
            <PiGearFill />
          </button>

          <div
            className={`avatar-status-badge ${statusBadgeClass}`}
            role="status"
            aria-live="polite"
          >
            {connectionState === ConnectionState.OFFLINE ? (
              <PiWifiSlashFill className="status-icon-offline" />
            ) : (
              <span
                className={`status-dot${connectionState === ConnectionState.RECONNECTING
                  ? ' status-dot-reconnecting'
                  : connectionState === ConnectionState.INITIALIZING
                    ? ' status-dot-initializing'
                    : ''
                  }`}
              />
            )}
            <span key={statusLabel} className="status-text">
              {statusLabel}
            </span>
            {reconnectError ? (
              <button type="button" onClick={reconnect} className="status-reconnect-btn">
                Reconnect
              </button>
            ) : null}
          </div>
        </div>

        <div
          className="split-container"
          id="main-content"
          style={{
            width: isSidebarOpen ? 'calc(100% - 320px)' : '100%'
          }}
        >
          <div className="avatar-panel">
            <div style={{ textAlign: 'center', color: 'var(--text-secondary, #b0b0b0)', fontSize: '1.2rem', fontWeight: 500 }}>
              Avatar Coming Soon...
            </div>
          </div>

          <div className="chat-panel" key={currentSessionId || 'empty'}>
            <MessageList
              messages={currentSession?.messages || []}
              outboxQueue={conversationState.outboxQueue || []}
              currentMessage={conversationState.currentMessage}
              interimTranscript={interimTranscript}
              error={conversationState.error}
              avatarName={avatarName}
              chatScrollRef={chatScrollRef}
              messagesEndRef={messagesEndRef}
              onScroll={handleChatScroll}
              pipelineState={conversationState.pipelineState}
            />
            <ChatInput
              inputValue={inputValue}
              onInputChange={setInputValue}
              onSend={handleSendMessage}
              onKeyDown={onKeyDown}
              textareaRef={textareaRef}
              backendStatus={connectionState}
              wsClient={{ connectionState, isConnected, send: safeSend, onMessage }}
              pipelineState={conversationState.pipelineState}
              onToggleDocuments={toggleDocuments}
            />
          </div>
        </div>
      </div>
    </>
  );
}

import { AvatarPanel } from '@/features/avatar';
import { getAvatarById, getAvatarModelPath } from '@/features/avatar/data/avatars';
import { ChatInput, MessageList } from '@/features/chat';
import { SettingsDrawer, useSessionManager } from '@/features/session';
import { loadSetup } from '@/features/setup';
import useConversationReducer from '@/shared/hooks/useConversationReducer';
import useWSClient, { ConnectionState } from '@/shared/hooks/useWSClient';
import Toast from '@/shared/utils/toast';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { PiGearFill, PiWifiSlashFill } from 'react-icons/pi';
import { useNavigate, useParams } from 'react-router-dom';
import { SCROLL_STICK_THRESHOLD_PX } from './constants';

const toast = new Toast('tr');

export default function ClassroomShell() {
  const { sessionId: urlSessionId } = useParams();
  const navigate = useNavigate();

  const setupConfig = useMemo(() => loadSetup(), []);
  const activeAvatarId = setupConfig?.avatarId || 'omar';
  const activeVoiceId = setupConfig?.voiceId || 'aria';
  const movementEnabled = setupConfig?.movementEnabled ?? false;
  const avatarModelPath = getAvatarModelPath(activeAvatarId);
  const wsAvatarId = avatarModelPath.split('/').pop().replace('.glb', '');

  const [conversationState, dispatch] = useConversationReducer();
  const session = useSessionManager(urlSessionId, navigate);

  const sessionList = session.sessions;
  const currentSessionId = session.currentSessionId;
  const currentSession = session.currentSession;
  const status = session.status;
  const createNewSession = session.createNewSession;
  const switchSession = session.switchSession;
  const deleteSession = session.deleteSession;
  const renameSession = session.renameSession;

  const WS_URL =
    status === 'success' && currentSessionId
      ? `ws://localhost:8000/api/v1/ws/${wsAvatarId}?voice=${encodeURIComponent(activeVoiceId)}&session_id=${currentSessionId}`
      : null;

  const { connectionState, isConnected, send, onMessage, reconnect, reconnectError } =
    useWSClient(WS_URL);

  const [audioUrl, setAudioUrl] = useState(null);
  const [mouthCues, setMouthCues] = useState([]);
  const [animationTimeline, setAnimationTimeline] = useState([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [avatarLoaded, setAvatarLoaded] = useState(false);

  const [avatarError, setAvatarError] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [emotionData, setEmotionData] = useState(null);

  const messagesEndRef = useRef(null);
  const chatScrollRef = useRef(null);
  const shouldStickToBottom = useRef(true);
  const textareaRef = useRef(null);
  const scrollPositionsRef = useRef(new Map());
  const prevSessionIdRef = useRef(currentSessionId);
  const timelineProtocolRef = useRef(null);

  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const commitAndSend = useCallback(
    async (text) => {
      let activeId = currentSessionId;
      if (!activeId) {
        toast.show('info', 'Starting chat', 'Initializing conversation...', 2000);
        activeId = await createNewSession();
        if (!activeId) {
          toast.show('error', 'Error', 'Failed to initialize session');
          return;
        }
      }

      const message_id = crypto.randomUUID();
      timelineProtocolRef.current = null;
      setAnimationTimeline([]);
      dispatch({ type: 'USER_MESSAGE', payload: { message_id, text } });
      sessionRef.current.addUserMessage(
        { id: message_id, role: 'user', content: text, timestamp: Date.now() },
        text
      );
      send({ type: 'chat.user_message', data: { message_id, text } });
    },
    [dispatch, send, currentSessionId, createNewSession]
  );

  const safeSend = useCallback(
    async (message) => {
      let activeId = currentSessionId;
      if (!activeId) {
        toast.show('info', 'Starting chat', 'Initializing conversation...', 2000);
        activeId = await createNewSession();
        if (!activeId) {
          toast.show('error', 'Error', 'Failed to initialize session');
          return;
        }
      }
      send(message);
    },
    [currentSessionId, createNewSession, send]
  );

  // Save / restore scroll position on session switch
  useEffect(() => {
    const prevId = prevSessionIdRef.current;
    const nextId = currentSessionId;
    if (prevId !== nextId) {
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
  }, [currentSessionId]);

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
      onMessage('chat.delta', (d) => dispatch({ type: 'CHAT_DELTA', payload: d })),
      onMessage('chat.final', (d) => {
        dispatch({ type: 'CHAT_FINAL', payload: d });
        sessionRef.current.addAssistantMessage(`${d.message_id}-assistant`, d.text);
        if (d.emotion) {
          // Shape expected by AvatarFaceController.applyAIResponse(): { primary, intensity }
          setEmotionData({
            primary: d.emotion,
            intensity: 0.85,
            timestamp: Date.now(),
          });
        }
      }),
      onMessage('pipeline.state', (d) => dispatch({ type: 'PIPELINE_STATE', payload: d })),
      onMessage('tts.ready', (d) => setAudioUrl(d.audio.url)),
      onMessage('visemes.ready', (d) => setMouthCues(d.mouthCues)),
      onMessage('animation.timeline.v2', (d) => {
        timelineProtocolRef.current = 'v2';
        setAnimationTimeline(Array.isArray(d.timeline) ? d.timeline : []);
      }),
      onMessage('animation.timeline', (d) => {
        if (timelineProtocolRef.current === 'v2') {
          return;
        }
        timelineProtocolRef.current = 'v1';
        setAnimationTimeline(Array.isArray(d.timeline) ? d.timeline : []);
      }),
      onMessage('error', (d) => {
        dispatch({ type: 'ERROR', payload: d });
        toast.show('error', 'Error', d.message || 'An error occurred', 5000);
      }),
      onMessage('transcript', (d) => {
        if (d.is_final) {
          setInterimTranscript('');
          if (d.text?.trim()) {
            const text = d.text.trim();
            commitAndSend(text);
          }
        } else {
          setInterimTranscript(d.text || '');
        }
      }),
    ];
    return () => unsubs.forEach((fn) => fn?.());
  }, [onMessage, dispatch, send, commitAndSend]);

  const avatarData = useMemo(() => getAvatarById(activeAvatarId), [activeAvatarId]);

  const handleAvatarError = useCallback(() => setAvatarError(true), []);
  const handleAvatarLoaded = useCallback(() => setAvatarLoaded(true), []);
  const openSettings = useCallback(() => setIsSettingsOpen(true), []);
  const closeSettings = useCallback(() => setIsSettingsOpen(false), []);

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
      toast.show('warning', 'Offline', 'Message queued. Will send when connected.', 3000);
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

  const avatarName = avatarData?.name || 'AI Tutor';

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
        />

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
                className={`status-dot${
                  connectionState === ConnectionState.RECONNECTING
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

        <div className="split-container" id="main-content">
          <AvatarPanel
            modelPath={avatarModelPath}
            avatarLoaded={avatarLoaded}
            avatarError={avatarError}
            pipelineState={conversationState.pipelineState}
            audioUrl={audioUrl}
            mouthCues={mouthCues}
            animationTimeline={animationTimeline}
            onModelLoaded={handleAvatarLoaded}
            onError={handleAvatarError}
            emotionData={emotionData}
            isMovementEnabled={movementEnabled}
          />

          <div className="chat-panel" key={currentSessionId || 'empty'}>
            {!currentSessionId ? (
              <div
                className="messages-loading"
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  height: '100%',
                  color: '#fff',
                  fontSize: '1.1rem',
                  flexDirection: 'column',
                  gap: '1rem',
                }}
              >
                Initializing session...
              </div>
            ) : (
              <>
                {currentSession && currentSession.messages_loaded !== true ? (
                  <div
                    className="messages-loading"
                    style={{
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      height: '100%',
                      color: '#fff',
                      fontSize: '1.1rem',
                    }}
                  >
                    Loading messages...
                  </div>
                ) : (
                  <MessageList
                    messages={currentSession.messages}
                    currentMessage={conversationState.currentMessage}
                    interimTranscript={interimTranscript}
                    error={conversationState.error}
                    avatarName={avatarName}
                    chatScrollRef={chatScrollRef}
                    messagesEndRef={messagesEndRef}
                    onScroll={handleChatScroll}
                    pipelineState={conversationState.pipelineState}
                  />
                )}
                <ChatInput
                  inputValue={inputValue}
                  onInputChange={setInputValue}
                  onSend={handleSendMessage}
                  onKeyDown={onKeyDown}
                  textareaRef={textareaRef}
                  backendStatus={connectionState}
                  wsClient={{ connectionState, isConnected, send: safeSend, onMessage }}
                  pipelineState={conversationState.pipelineState}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

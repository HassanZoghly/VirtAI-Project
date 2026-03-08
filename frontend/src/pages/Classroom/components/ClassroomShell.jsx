import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PiGearFill, PiWifiSlashFill } from 'react-icons/pi';
import { getAvatarById, getAvatarModelPath } from '../../../data/avatars';
import AvatarPanel from '../../../features/avatar/components/AvatarPanel';
import ChatInput from '../../../features/chat/components/ChatInput';
import MessageList from '../../../features/chat/components/MessageList';
import RenameModal from '../../../features/session/components/RenameModal';
import SettingsDrawer from '../../../features/session/components/SettingsDrawer';
import useSessionManager from '../../../features/session/hooks/useSessionManager';
import { loadSetup } from '../../../features/setup/services/setupStorage';
import useConversationReducer from '../../../shared/hooks/useConversationReducer';
import useWSClient, { ConnectionState } from '../../../shared/hooks/useWSClient';
import Toast from '../../../shared/utils/toast';
import { SCROLL_STICK_THRESHOLD_PX } from '../constants';

const toast = new Toast('tr');

export default function ClassroomShell() {
  const setupConfig = useMemo(() => loadSetup(), []);
  const activeAvatarId = setupConfig?.avatarId || 'omar';
  const avatarModelPath = getAvatarModelPath(activeAvatarId);
  const wsAvatarId = avatarModelPath.split('/').pop().replace('.glb', '');
  const WS_URL = `ws://localhost:8000/api/v1/ws/${wsAvatarId}`;
  const { connectionState, isConnected, send, onMessage } = useWSClient(WS_URL);
  const [conversationState, dispatch] = useConversationReducer();
  const session = useSessionManager();

  const [audioUrl, setAudioUrl] = useState(null);
  const [mouthCues, setMouthCues] = useState([]);
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
  const prevSessionIdRef = useRef(session.currentSessionId);

  // Save / restore scroll position on session switch
  useEffect(() => {
    const prevId = prevSessionIdRef.current;
    const nextId = session.currentSessionId;
    if (prevId !== nextId) {
      // Save scroll position of outgoing session
      if (chatScrollRef.current) {
        scrollPositionsRef.current.set(prevId, chatScrollRef.current.scrollTop);
      }
      // Restore scroll position of incoming session (next tick after render)
      requestAnimationFrame(() => {
        const saved = scrollPositionsRef.current.get(nextId);
        if (chatScrollRef.current && saved != null) {
          chatScrollRef.current.scrollTop = saved;
          shouldStickToBottom.current = false;
        } else {
          shouldStickToBottom.current = true;
        }
      });
      prevSessionIdRef.current = nextId;
    }
  }, [session.currentSessionId]);

  // WebSocket message subscriptions
  useEffect(() => {
    const unsubs = [
      onMessage('chat.delta', (d) => dispatch({ type: 'CHAT_DELTA', payload: d })),
      onMessage('chat.final', (d) => {
        dispatch({ type: 'CHAT_FINAL', payload: d });
        session.addAssistantMessage(`${d.message_id}-assistant`, d.text);
        if (d.emotion) {
          setEmotionData({ emotion: d.emotion, timestamp: Date.now() });
        }
      }),
      onMessage('pipeline.state', (d) => dispatch({ type: 'PIPELINE_STATE', payload: d })),
      onMessage('tts.ready', (d) => setAudioUrl(d.audio.url)),
      onMessage('visemes.ready', (d) => setMouthCues(d.mouthCues)),
      onMessage('error', (d) => {
        dispatch({ type: 'ERROR', payload: d });
        toast.show('error', 'Error', d.message || 'An error occurred', 5000);
      }),
      onMessage('transcript', (d) => {
        if (d.is_final) {
          setInterimTranscript('');
          if (d.text?.trim()) {
            const text = d.text.trim();
            const message_id = crypto.randomUUID();
            dispatch({ type: 'USER_MESSAGE', payload: { message_id, text } });
            session.addUserMessage(
              { id: message_id, role: 'user', content: text, timestamp: Date.now() },
              text
            );
            send({ type: 'chat.user_message', data: { message_id, text } });
          }
        } else {
          setInterimTranscript(d.text || '');
        }
      }),
    ];
    return () => unsubs.forEach((fn) => fn?.());
  }, [onMessage, dispatch, session.addAssistantMessage, session.addUserMessage, send]);

  const avatarData = useMemo(() => getAvatarById(activeAvatarId), [activeAvatarId]);

  const handleAvatarError = useCallback(() => setAvatarError(true), []);
  const handleAvatarLoaded = useCallback(() => setAvatarLoaded(true), []);
  const openSettings = useCallback(() => setIsSettingsOpen(true), []);
  const closeSettings = useCallback(() => setIsSettingsOpen(false), []);

  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    shouldStickToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_STICK_THRESHOLD_PX;
  }, []);

  useEffect(() => {
    if (!shouldStickToBottom.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session.currentSession.messages, conversationState.currentMessage, interimTranscript]);

  const handleSendMessage = useCallback(() => {
    const text = inputValue.trim();
    if (!text) return;
    const message_id = crypto.randomUUID();
    dispatch({ type: 'USER_MESSAGE', payload: { message_id, text } });
    session.addUserMessage(
      { id: message_id, role: 'user', content: text, timestamp: Date.now() },
      text
    );
    send({ type: 'chat.user_message', data: { message_id, text } });

    setInputValue('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    if (!isConnected) {
      toast.show('warning', 'Offline', 'Message queued. Will send when connected.', 3000);
    }
  }, [inputValue, isConnected, send, dispatch, session.addUserMessage]);

  const handleSendText = useCallback(
    (text) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const message_id = crypto.randomUUID();
      dispatch({ type: 'USER_MESSAGE', payload: { message_id, text: trimmed } });
      session.addUserMessage(
        { id: message_id, role: 'user', content: trimmed, timestamp: Date.now() },
        trimmed
      );
      send({ type: 'chat.user_message', data: { message_id, text: trimmed } });
      if (!isConnected) {
        toast.show('warning', 'Offline', 'Message queued. Will send when connected.', 3000);
      }
    },
    [isConnected, send, dispatch, session.addUserMessage]
  );

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
    {
      [ConnectionState.OFFLINE]: `${avatarName} — Offline`,
      [ConnectionState.RECONNECTING]: 'Reconnecting…',
      [ConnectionState.INITIALIZING]: 'Starting up…',
      [ConnectionState.ONLINE]: `${avatarName} Online`,
    }[connectionState] || `${avatarName} — Offline`;

  return (
    <div className="classroom-shell">
      <SettingsDrawer
        isOpen={isSettingsOpen}
        onClose={closeSettings}
        sessions={session.sessions}
        currentSessionId={session.currentSessionId}
        onSessionSelect={session.switchSession}
        onNewSession={session.createNewSession}
        onDeleteSession={session.deleteSession}
        onRenameClick={session.openRenameModal}
      />

      <button
        className="avatar-settings-btn"
        onClick={openSettings}
        title="Settings"
        aria-label="Open settings"
      >
        <PiGearFill />
      </button>

      <div className={`avatar-status-badge ${statusBadgeClass}`} role="status" aria-live="polite">
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
        <span className="status-text">{statusLabel}</span>
      </div>

      <div className="split-container" id="main-content">
        <AvatarPanel
          modelPath={avatarModelPath}
          avatarLoaded={avatarLoaded}
          avatarError={avatarError}
          pipelineState={conversationState.pipelineState}
          audioUrl={audioUrl}
          mouthCues={mouthCues}
          onModelLoaded={handleAvatarLoaded}
          onError={handleAvatarError}
          emotionData={emotionData}
        />

        <div className="chat-panel" key={session.currentSessionId}>
          <MessageList
            messages={session.currentSession.messages}
            currentMessage={conversationState.currentMessage}
            interimTranscript={interimTranscript}
            error={conversationState.error}
            avatarName={avatarName}
            chatScrollRef={chatScrollRef}
            messagesEndRef={messagesEndRef}
            onScroll={handleChatScroll}
            pipelineState={conversationState.pipelineState}
            onSendText={handleSendText}
          />
          <ChatInput
            inputValue={inputValue}
            onInputChange={setInputValue}
            onSend={handleSendMessage}
            onKeyDown={onKeyDown}
            textareaRef={textareaRef}
            backendStatus={connectionState}
            wsClient={{ connectionState, isConnected, send, onMessage }}
            pipelineState={conversationState.pipelineState}
          />
        </div>
      </div>

      <RenameModal
        isOpen={session.isRenameModalOpen}
        sessionTitle={session.sessionToRename?.title || ''}
        onConfirm={session.handleRenameConfirm}
        onCancel={session.handleRenameCancel}
      />
    </div>
  );
}

import { z } from 'zod';
import { PCMRecorder } from '@/features/voice/audio/pcmRecorder';
import { ConnectionState } from '@/core/realtime/useWSClient';
import { ChatInput, MessageList } from '@/features/chat';
import { DocumentsDrawer } from '@/features/documents/components/DocumentsDrawer';
import { SettingsDrawer, useSessionManager } from '@/features/session';
import { toast } from '@/shared/utils/toast';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { PiGearFill, PiWifiSlashFill } from 'react-icons/pi';
import { useNavigate, useParams } from 'react-router-dom';
import { SCROLL_STICK_THRESHOLD_PX } from './constants';
import { AvatarCanvasWrapper } from './AvatarCanvasWrapper';
import { useClassroomState } from './hooks/useClassroomState';
import { useClassroomAudio } from './hooks/useClassroomAudio';
import { useClassroomChat } from './hooks/useClassroomChat';
import { AvatarTopBar } from './AvatarTopBar';
import { useDocumentList } from '@/features/documents/useDocumentList';
import { useQuizSession } from '@/features/quiz/hooks/useQuizSession';
import { QuizDrawer } from '@/features/quiz/components/QuizDrawer';
import { DiagramContainer } from '@/features/diagrams/components/DiagramContainer';
import { useExplainWS, PresentationState } from '@/features/explain/hooks/useExplainWS';
import { ExplainSession } from '@/features/explain/components/ExplainSession';

export interface AudioVisemePacket {
  id: string;
  url: string;
  mouthCues: Viseme[];
}

export const VisemeSchema = z.object({
  start: z.number().catch(0),
  end: z.number().catch(0),
  value: z.string().catch(''),
}).passthrough();

export type Viseme = z.infer<typeof VisemeSchema>;

export interface PendingFirstMessage {
  message_id: string;
  text: string;
}

export const WSPayloadSchema = z.object({
  session_id: z.string().optional(),
  message_id: z.string().optional(),
  text: z.string().optional(),
  delta: z.string().optional(),
  is_final: z.boolean().optional(),
  audio: z.object({
    url: z.string().optional(),
    duration_ms: z.number().optional()
  }).passthrough().optional(),
  mouthCues: z.array(VisemeSchema).optional(),
  message: z.string().optional(),
  state: z.enum(['idle', 'thinking', 'speaking', 'error']).optional(),
}).passthrough();

export type WSPayload = z.infer<typeof WSPayloadSchema>;

export default function ClassroomShell() {
  const { sessionId: urlSessionId } = useParams();
  const navigate = useNavigate();

  // Phase 1: Isolated State
  const {
    activeAvatarId,
    activeVoiceId,
    movementEnabled,
    avatarName,
    isSettingsOpen,
    isDocumentsOpen,
    openSettings,
    closeSettings,
    toggleDocuments,
  } = useClassroomState();

  const session = useSessionManager(urlSessionId, navigate);
  const currentSessionId = session.currentSessionId;
  const currentSession = session.currentSession;
  const status = session.status;

  const { documents } = useDocumentList(currentSessionId);
  const quizSession = useQuizSession();
  const [isQuizOpen, setIsQuizOpen] = useState(false);
  const [isDiagramOpen, setIsDiagramOpen] = useState(false);

  const handleTakeQuiz = () => {
    if (documents.length > 0 && documents[0].id) {
      quizSession.startQuiz(documents[0].id, 'en');
      setIsQuizOpen(true);
    }
  };

  const handleGenerateDiagram = () => {
    setIsDiagramOpen(true);
  };

  // Phase 2: Isolated Audio Pipeline
  const {
    mouthCuesRef,
    getAudioContext,
    playbackStartTimeRef,
    handleTtsReady,
    handleVisemesReady,
    forceAdvanceSequence,
    resetAvatarAudio,
    getIsAudioPlaying,
    getNextPlaybackTime
  } = useClassroomAudio();

  const [isExplainActive, setIsExplainActive] = useState(false);
  const [explainContent, setExplainContent] = useState('');
  const [explainState, setExplainState] = useState<PresentationState>('EXPLAINING');
  const [explainSlide, setExplainSlide] = useState(0);
  const [explainTotalSlides, setExplainTotalSlides] = useState(0);

  const {
    isConnected: isExplainConnected,
    sendQuestion: explainSendQuestion,
    sendContinue: explainSendContinue,
    sendPauseOrStop: explainSendPauseOrStop,
    disconnect: explainDisconnect
  } = useExplainWS({
    documentId: isExplainActive && documents.length > 0 ? documents[0].id : null,
    onTokens: (tokens) => {
      setExplainContent(prev => prev + tokens);
    },
    onStateChange: (state) => {
      setExplainState(state);
    },
    onSlideChange: (index, total) => {
      setExplainSlide(index);
      setExplainTotalSlides(total);
      setExplainContent(''); // clear text for new slide
    },
    onEnd: () => {
      setIsExplainActive(false);
    }
  });

  const handleStartExplain = useCallback(() => {
    setIsExplainActive(true);
    setExplainContent('');
  }, []);

  // Phase 1: Isolated Chat Logic
  const {
    conversationState,
    connectionState,
    isConnected,
    reconnect,
    reconnectError,
    disconnect,
    safeSend,
    commitAndSend,
    inputValue,
    setInputValue,
    interimTranscript,
    onMessage,
    wsClient
  } = useClassroomChat({
    wsAvatarId: activeAvatarId,
    activeVoiceId,
    session,
    onTtsReady: handleTtsReady,
    onVisemesReady: handleVisemesReady as any,
    forceAdvanceSequence,
    resetAvatarAudio,
    getAudioContext
  });

  const handleClearAllSessions = useCallback(async () => {
    disconnect();
    await session.clearAllSessions();
  }, [disconnect, session]);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    if (sessionId === currentSessionId) {
      disconnect();
    }
    await session.deleteSession(sessionId);
  }, [disconnect, session, currentSessionId]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottom = useRef<boolean>(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollPositionsRef = useRef<Map<string | null, number>>(new Map());
  const prevSessionIdRef = useRef<string | null>(currentSessionId);
  const isCreatingSessionRef = useRef<boolean>(false);

  // Save / restore scroll position on session switch
  useEffect(() => {
    const prevId = prevSessionIdRef.current;
    const nextId = currentSessionId;
    if (prevId !== nextId) {
      resetAvatarAudio();
      
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

  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    shouldStickToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_STICK_THRESHOLD_PX;
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentSession?.messages, conversationState.currentMessage, interimTranscript]);

  const handleStop = useCallback(() => {
    safeSend({ 
      type: 'chat.abort',
      data: {
        session_id: currentSessionId || undefined,
        message_id: conversationState.activeMessageId || undefined
      }
    });
    resetAvatarAudio(conversationState.activeMessageId);
  }, [safeSend, resetAvatarAudio, currentSessionId, conversationState.activeMessageId]);

  useEffect(() => {
    const handleVoiceBargeIn = () => {
      // DEFENSIVE: Listen for out-of-band VAD interruption and instantly kill audio.
      handleStop();
    };
    window.addEventListener('voice-barge-in', handleVoiceBargeIn);
    return () => window.removeEventListener('voice-barge-in', handleVoiceBargeIn);
  }, [handleStop]);

  const handleSendMessage = useCallback(() => {
    const text = inputValue.trim();
    if (!text) return;
    
    commitAndSend(text);
    setInputValue('');
    
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    if (!isConnected && currentSessionId !== null) {
      toast.warning('Offline', 'Message queued. Will send when connected.', 3000);
    }
  }, [inputValue, isConnected, currentSessionId, commitAndSend, setInputValue]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    },
    [handleSendMessage]
  );

  const ensureVoiceSession = useCallback(async () => {
    PCMRecorder.preWarmWorklet();
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    
    if (currentSessionId) return true;
    if (isCreatingSessionRef.current) return false;
    
    isCreatingSessionRef.current = true;
    try {
      const activeId = await session.createPersistedSession();
      if (!activeId) {
        toast.error('Error', 'Failed to initialize voice session');
        return false;
      }
      return true;
    } finally {
      isCreatingSessionRef.current = false;
    }
  }, [currentSessionId, session, getAudioContext]);

  const statusBadgeClass =
    !currentSessionId ? 'idle' :
    {
      [ConnectionState.OFFLINE]: 'offline',
      [ConnectionState.RECONNECTING]: 'reconnecting',
      [ConnectionState.INITIALIZING]: 'initializing',
      [ConnectionState.ONLINE]: 'online',
    }[connectionState] || 'offline';

  const statusLabel =
    !currentSessionId ? `${avatarName} — Ready` :
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

  const isSidebarOpen = isSettingsOpen || isDocumentsOpen;

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
          sessions={session.sessions}
          currentSessionId={currentSessionId}
          onSessionSelect={session.switchSession}
          onNewSession={session.createNewSession}
          onDeleteSession={handleDeleteSession}
          onRenameSession={session.renameSession}
          onClearAllSessions={handleClearAllSessions}
        />
        <DocumentsDrawer isOpen={isDocumentsOpen} onClose={toggleDocuments} sessionId={currentSessionId} />

        <AvatarTopBar
          avatarName={avatarName}
          connectionState={connectionState}
          currentSessionId={currentSessionId}
          reconnectError={reconnectError}
          openSettings={openSettings}
          reconnect={reconnect}
          hasDocuments={documents.length > 0}
          hasMessages={currentSession?.messages?.length ? currentSession.messages.length > 0 : false}
          onTakeQuiz={handleTakeQuiz}
          onGenerateDiagram={handleGenerateDiagram}
          onStartExplain={handleStartExplain}
        />

        <QuizDrawer
          isOpen={isQuizOpen}
          onClose={() => setIsQuizOpen(false)}
          documentId={documents.length > 0 ? documents[0].id : null}
          quizSession={quizSession}
        />

        <DiagramContainer
          isOpen={isDiagramOpen}
          onClose={() => setIsDiagramOpen(false)}
          sessionId={currentSessionId}
        />

        <div
          className="split-container"
          id="main-content"
          style={{
            width: isSidebarOpen ? 'calc(100% - 320px)' : '100%'
          }}
        >
          <AvatarCanvasWrapper 
            avatarId={activeAvatarId}
            pipelineState={conversationState.pipelineState}
            movementEnabled={movementEnabled}
            mouthCuesRef={mouthCuesRef}
            getAudioContext={getAudioContext}
            playbackStartTimeRef={playbackStartTimeRef}
            getIsAudioPlaying={getIsAudioPlaying}
            getNextPlaybackTime={getNextPlaybackTime}
          />

          {isExplainActive ? (
            <div className="chat-panel explain-panel-active">
              <ExplainSession
                documentId={documents[0].id}
                currentState={explainState}
                currentSlide={explainSlide}
                totalSlides={explainTotalSlides}
                content={explainContent}
                onQuestion={(text) => {
                  explainSendQuestion(text);
                  setExplainContent(prev => prev + `\n\n**You:** ${text}\n\n`);
                  resetAvatarAudio();
                }}
                onContinue={() => {
                  explainSendContinue();
                  resetAvatarAudio();
                }}
                onPauseOrStop={() => {
                  explainSendPauseOrStop();
                  resetAvatarAudio();
                }}
                onClose={() => {
                  setIsExplainActive(false);
                  explainDisconnect();
                  resetAvatarAudio();
                }}
              />
            </div>
          ) : (
            <div className="chat-panel" key={currentSessionId || 'empty'}>
              <MessageList
                messages={currentSession?.messages || []}
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
                backendStatus={connectionState as any}
                wsClient={wsClient}
                pipelineState={conversationState.pipelineState}
                onToggleDocuments={toggleDocuments}
                onBeforeVoiceStart={ensureVoiceSession}
                onStop={handleStop}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

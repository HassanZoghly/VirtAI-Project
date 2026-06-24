import { ChatInput, MessageList } from '@/features/chat';
import { DiagramContainer } from '@/features/diagrams/components/DiagramContainer';
import { DocumentsDrawer } from '@/features/documents/components/DocumentsDrawer';
import { useDocumentList } from '@/features/documents/useDocumentList';
import { ExplainSession } from '@/features/explain/components/ExplainSession';
import { PresentationState, useExplainWS } from '@/features/explain/hooks/useExplainWS';
import { SettingsDrawer, useSessionManager } from '@/features/session';
import { PCMRecorder } from '@/features/voice/audio/pcmRecorder';
import { toast } from '@/shared/utils/toast';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { AvatarCanvasWrapper } from './AvatarCanvasWrapper';
import { AvatarTopBar } from './AvatarTopBar';
import { SCROLL_STICK_THRESHOLD_PX } from './constants';
import { useClassroomAudio } from './hooks/useClassroomAudio';
import { useClassroomChat } from './hooks/useClassroomChat';
import { useClassroomState } from './hooks/useClassroomState';
import { WSContext } from '@/core/realtime/WSContext';

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

  const {
    activeAvatarId,
    activeVoiceId,
    movementEnabled,
    avatarName,
    isSettingsOpen,
    isDocumentsOpen,
    sidebarWidth,
    setSidebarWidth,
    openSettings,
    closeSettings,
    toggleDocuments,
  } = useClassroomState();

  const session = useSessionManager(urlSessionId, navigate);
  const currentSessionId = session.currentSessionId;
  const currentSession = session.currentSession;
  const status = session.status;

  const { documents } = useDocumentList(currentSessionId);
  const [isDiagramOpen, setIsDiagramOpen] = useState(false);

  const handleGenerateDiagram = () => {
    setIsDiagramOpen(true);
  };

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
      setExplainContent('');
    },
    onEnd: () => {
      setIsExplainActive(false);
    }
  });

  const handleStartExplain = useCallback(() => {
    setIsExplainActive(true);
    setExplainContent('');
  }, []);

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

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    const handleOpenSessions = () => openSettings();
    window.addEventListener('open-sessions', handleOpenSessions);
    return () => window.removeEventListener('open-sessions', handleOpenSessions);
  }, [openSettings]);

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

  if (status === 'error') {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0D0D0D] text-red-500 text-lg">
        Failed to load sessions. Please refresh the page.
      </div>
    );
  }

  const isSidebarOpen = isSettingsOpen || isDocumentsOpen;

  return (
    <WSContext.Provider
      value={{
        connectionState,
        isConnected,
        send: safeSend,
        reconnect,
        disconnect,
        currentSessionId,
        onMessage,
      }}
    >
      <Helmet>
        <title>{avatarName} — VirtAI Classroom</title>
      </Helmet>

      {/* Root Layout: Handled by AppLayout, we just provide the full width/height container */}
      <div className="flex w-full h-full relative text-white font-sans">

        {/* Floating Sidebars/Drawers */}
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
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
          resizable={true}
        />
        <DocumentsDrawer
          isOpen={isDocumentsOpen}
          onClose={toggleDocuments}
          sessionId={currentSessionId}
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
          resizable={true}
        />

        {/* Main Content Area */}
        <div
          className="flex flex-col flex-1 gap-3 p-3 lg:p-4 lg:gap-3 relative"
          style={{ marginRight: isSidebarOpen ? `${sidebarWidth}px` : '0' }}
        >

          {/* Top Navbar */}
          <AvatarTopBar
            avatarName={avatarName || 'AI Tutor'}
            connectionState={connectionState}
            currentSessionId={currentSessionId}
            reconnectError={reconnectError}
            reconnect={reconnect}
            hasDocuments={documents.length > 0}
            hasMessages={currentSession?.messages?.length ? currentSession.messages.length > 0 : false}
            onGenerateDiagram={handleGenerateDiagram}
            onStartExplain={handleStartExplain}
          />

          {/* The Two Distinct Containers */}
          <div className="flex flex-row w-full flex-1 min-h-0 gap-3">

            {/* Avatar Panel (Left) */}
            <div className="flex-[3] min-w-0 min-h-0 rounded-3xl bg-[#1A1A1A] relative overflow-hidden flex items-center justify-center">
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
            </div>

            {/* Chat Panel (Right) */}
            <div className="flex-[7] min-w-0 min-h-0 rounded-3xl bg-[#1A1A1A] flex flex-col">
              {isExplainActive ? (
                <div className="flex-1 overflow-y-auto">
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
              ) : isDiagramOpen ? (
                <DiagramContainer
                  isOpen={isDiagramOpen}
                  onClose={() => setIsDiagramOpen(false)}
                  sessionId={currentSessionId}
                />
              ) : (
                <>
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
                  <div className="mt-auto">
                    <ChatInput
                      inputValue={inputValue}
                      onInputChange={setInputValue}
                      onSend={handleSendMessage}
                      onKeyDown={onKeyDown}
                      textareaRef={textareaRef}
                      pipelineState={conversationState.pipelineState}
                      onToggleDocuments={toggleDocuments}
                      onBeforeVoiceStart={ensureVoiceSession}
                      onStop={handleStop}
                    />
                  </div>
                </>
              )}
            </div>

          </div>
        </div>
      </div>
    </WSContext.Provider>
  );
}

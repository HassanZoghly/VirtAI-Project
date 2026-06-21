import { useCallback, useEffect, useRef, useState } from 'react';
import useWSClient from '@/core/realtime/useWSClient';
import useConversationReducer from '@/features/chat/hooks/useConversationReducer';
import { toast } from '@/shared/utils/toast';
import { WSPayloadSchema, WSPayload, Viseme } from '../ClassroomShell';
import { PCMRecorder } from '@/features/voice/audio/pcmRecorder';

export function buildWsUrl(avatarId: string, voiceId: string, sessionId?: string | null) {
  const configuredBase = import.meta.env.VITE_WS_BASE_URL;
  const base =
    configuredBase ||
    `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`;
  const url = new URL(`/api/v1/ws/${avatarId}`, base);
  url.searchParams.set('voice', voiceId);
  if (sessionId) {
    url.searchParams.set('session_id', sessionId);
  }
  return url.toString();
}

interface UseClassroomChatProps {
  wsAvatarId: string;
  activeVoiceId: string;
  session: any; // Using the type from useSessionManager
  onTtsReady: (messageId: string | undefined, url: string) => void;
  onVisemesReady: (messageId: string, cues: Viseme[]) => void;
  resetAvatarAudio: () => void;
  getAudioContext: () => AudioContext;
}

export function useClassroomChat({
  wsAvatarId,
  activeVoiceId,
  session,
  onTtsReady,
  onVisemesReady,
  resetAvatarAudio,
  getAudioContext
}: UseClassroomChatProps) {
  const [conversationState, dispatch] = useConversationReducer();
  const currentSessionId = session.currentSessionId;
  const status = session.status;
  
  const WS_URL = status === 'success' && currentSessionId 
    ? buildWsUrl(wsAvatarId, activeVoiceId, currentSessionId) 
    : null;

  const { connectionState, isConnected, send, onMessage, reconnect, reconnectError, disconnect } =
    useWSClient(WS_URL);

  const [inputValue, setInputValue] = useState<string>('');
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  
  const pendingFirstMessagesRef = useRef<any[]>([]);
  const currentSessionIdRef = useRef<string | null>(currentSessionId);
  const sessionRef = useRef(session);

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    if (isConnected && pendingFirstMessagesRef.current.length > 0 && currentSessionId) {
      const messages = [...pendingFirstMessagesRef.current];
      pendingFirstMessagesRef.current = [];
      messages.forEach(({ text, message_id }) => {
        sessionRef.current.addUserMessage(
          { id: message_id, role: 'user', content: text, timestamp: Date.now() },
          currentSessionId
        );
        send({ type: 'chat.user_message', data: { message_id, text } });
      });
    }
  }, [isConnected, currentSessionId, send]);

  useEffect(() => {
    if (!currentSessionId) {
      dispatch({ type: 'RESET' });
      resetAvatarAudio();
    }
  }, [currentSessionId, dispatch, resetAvatarAudio]);

  const commitAndSend = useCallback(
    (text: string) => {
      PCMRecorder.preWarmWorklet();
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      let activeId = currentSessionId;
      if (!activeId) {
        const message_id = crypto.randomUUID();
        resetAvatarAudio();
        dispatch({ type: 'USER_MESSAGE', payload: { message_id, text } });
        dispatch({ type: 'PIPELINE_STATE', payload: { state: 'thinking' } });
        pendingFirstMessagesRef.current.push({ message_id, text });

        sessionRef.current.handleFirstMessage(text).then((newId: string | null) => {
          if (!newId) {
            pendingFirstMessagesRef.current = [];
            dispatch({ type: 'PIPELINE_STATE', payload: { state: 'idle' } });
            toast.error('Error', 'Failed to start a new conversation.');
          }
        });
      } else {
        const message_id = crypto.randomUUID();
        resetAvatarAudio();
        dispatch({ type: 'USER_MESSAGE', payload: { message_id, text } });
        dispatch({ type: 'PIPELINE_STATE', payload: { state: 'thinking' } });
        sessionRef.current.addUserMessage(
          { id: message_id, role: 'user', content: text, timestamp: Date.now() },
          activeId
        );
        send({ type: 'chat.user_message', data: { message_id, text } });
      }
    },
    [dispatch, send, currentSessionId, resetAvatarAudio, getAudioContext]
  );

  const safeSend = useCallback(
    (message: Record<string, unknown>) => {
      send(message);
    },
    [send]
  );

  useEffect(() => {
    const checkSession = (d: WSPayload) => {
      if (d && d.session_id && d.session_id !== currentSessionIdRef.current) return false;
      return true;
    };

    const validatePayload = (rawData: unknown): WSPayload | null => {
      const result = WSPayloadSchema.safeParse(rawData);
      if (!result.success) {
        if (import.meta.env.DEV) {
          console.warn('[WS] Payload validation failed:', result.error);
        }
        return null;
      }
      return result.data;
    };

    const unsubs = [
      onMessage('user.message.echo', (rawData: unknown) => {
        const d = validatePayload(rawData);
        if (!d || !checkSession(d)) return;
        if (!d.message_id || !d.text) return;
        
        const echoSessionId = d.session_id || currentSessionId;
        dispatch({ type: 'USER_MESSAGE', payload: { message_id: d.message_id, text: d.text } });
        sessionRef.current.addUserMessage(
          { id: d.message_id, role: 'user', content: d.text, timestamp: Date.now() },
          echoSessionId
        );
        if (echoSessionId) {
          sessionRef.current.generateTitleForSession(echoSessionId, d.text);
        }
      }),
      onMessage('chat.delta', (rawData: unknown) => {
        const d = validatePayload(rawData);
        if (!d || !checkSession(d)) return;
        const safePayload = { ...d, delta: d.delta ? d.delta.replace(/\[.*?\]/g, '') : undefined };
        dispatch({ type: 'CHAT_DELTA', payload: safePayload });
      }),
      onMessage('chat.final', (rawData: unknown) => {
        const d = validatePayload(rawData);
        if (!d || !checkSession(d)) return;
        const safePayload = { ...d, text: d.text ? d.text.replace(/\[.*?\]/g, '') : undefined };
        dispatch({ type: 'CHAT_FINAL', payload: safePayload });
        if (safePayload.text) {
          sessionRef.current.addAssistantMessage(`${d.message_id}-assistant`, safePayload.text, d.session_id);
        }
      }),
      onMessage('pipeline.state', (rawData: unknown) => {
        const d = validatePayload(rawData);
        if (!d || !checkSession(d)) return;
        dispatch({ type: 'PIPELINE_STATE', payload: d });
      }),
      onMessage('tts.ready', (rawData: unknown) => {
        const d = validatePayload(rawData);
        if (!d || !checkSession(d)) return;
        const url = d.audio?.url;
        if (!url) return;
        
        onTtsReady(d.message_id, url);
      }),
      onMessage('visemes.ready', (rawData: unknown) => {
        const d = validatePayload(rawData);
        if (!d || !checkSession(d)) return;
        
        if (d.message_id) {
          onVisemesReady(d.message_id, d.mouthCues || []);
        }
      }),
      onMessage('error', (rawData: unknown) => {
        const d = validatePayload(rawData);
        if (!d || !checkSession(d)) return;
        dispatch({ type: 'ERROR', payload: d });
        toast.error('Error', d.message || 'An error occurred', 5000);
      }),
      onMessage('transcript', (rawData: unknown) => {
        const d = validatePayload(rawData);
        if (!d || !checkSession(d)) return;
        if (d.is_final) {
          setInterimTranscript('');
        } else {
          setInterimTranscript(d.text || '');
        }
      }),
    ];
    return () => unsubs.forEach((fn) => fn?.());
  }, [onMessage, dispatch, currentSessionId, onTtsReady, onVisemesReady]);

  return {
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
    onMessage
  };
}

import { logger } from '@/shared/utils/logger';
import { useCallback, useEffect, useRef, useState } from 'react';
import { OptimizedVADProcessor } from '../audio/vadOptimized';
import { useMicrophoneStream } from './useMicrophoneStream';

export interface VoiceModeHook {
  isListening: boolean;
  toggleListening: () => void;
  error: string | null;
  errorCode: string | null;
  canRetry: boolean;
  clearError: () => void;
}

interface VoiceModeState {
  isListening: boolean;
  error: string | null;
  errorCode: string | null;
  canRetry: boolean;
}

interface WSClient {
  connectionState?: string;
  isConnected: boolean;
  send: (message: any) => void;
  onMessage: (type: string, handler: (data: any) => void) => () => void;
}

interface TranscriptMessage {
  type: 'transcript';
  session_id: string;
  text: string;
  confidence: number;
  language?: string;
  is_final: boolean;
}

interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
  session_id?: string;
  details?: unknown;
}

export function useVoiceMode(
  wsClient: WSClient,
  pipelineState: 'idle' | 'thinking' | 'speaking' | 'error'
): VoiceModeHook {
  const [state, setState] = useState<VoiceModeState>({
    isListening: false,
    error: null,
    errorCode: null,
    canRetry: false,
  });

  const vadRef = useRef<OptimizedVADProcessor | null>(null);

  const continuousSpeechMsRef = useRef<number>(0);
  const hasBargedInRef = useRef<boolean>(false);
  const isCurrentlyStreamingRef = useRef<boolean>(false);
  const float32BufferRef = useRef<Float32Array | null>(null);

  const stopListeningRef = useRef<() => void>(() => { });

  if (vadRef.current === null) {
    vadRef.current = new OptimizedVADProcessor(
      {
        silenceThreshold: 0.01,
        silenceDuration: 800,
        minSpeechDuration: 300,
      },
      {
        enableWorker: true,
        bufferCapacity: 100,
      }
    );
  }

  const handleAudioChunk = useCallback(
    (pcmData: Int16Array) => {
      try {
        if (!float32BufferRef.current || float32BufferRef.current.length !== pcmData.length) {
          float32BufferRef.current = new Float32Array(pcmData.length);
        }

        const float32Data = float32BufferRef.current;
        for (let i = 0; i < pcmData.length; i++) {
          float32Data[i] = pcmData[i] / (pcmData[i] < 0 ? 0x8000 : 0x7fff);
        }

        const vadResult = vadRef.current!.processAudioChunk(float32Data);
        const chunkDurationMs = (pcmData.length / 16000) * 1000;

        if (vadResult.isSpeech) {
          continuousSpeechMsRef.current += chunkDurationMs;

          if (
            continuousSpeechMsRef.current >= 300 &&
            pipelineState === 'speaking' &&
            !hasBargedInRef.current
          ) {
            hasBargedInRef.current = true;
            if (wsClient.isConnected) {
              wsClient.send(
                JSON.stringify({
                  type: 'client.barge_in',
                  timestamp: Date.now(),
                })
              );
            }
          }
        } else {
          continuousSpeechMsRef.current = 0;
        }

        if (vadResult.isSpeech || vadResult.isPostRollTail || isCurrentlyStreamingRef.current) {
          isCurrentlyStreamingRef.current = true;

          if (wsClient.isConnected) {
            const pcmBytes = new Uint8Array(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength);
            wsClient.send(pcmBytes.buffer);
          }
        }

        if (vadResult.shouldFinalize) {
          isCurrentlyStreamingRef.current = false;
          hasBargedInRef.current = false;
          continuousSpeechMsRef.current = 0;

          if (wsClient.isConnected) {
            wsClient.send(
              JSON.stringify({
                type: 'client.speech_stopped',
                timestamp: Date.now(),
              })
            );
          }
        }
      } catch (err) {
        logger.error('[VoiceMode] Failed to process audio chunk:', err);
      }
    },
    [pipelineState, wsClient]
  );

  const handleTranscript = useCallback((message: TranscriptMessage) => {
    if (import.meta.env.DEV) {
      logger.debug(`[VoiceMode] Transcript received: ${message.text}`);
    }
  }, []);

  const {
    isListening: micIsListening,
    startListening,
    stopListening,
    error: micError,
  } = useMicrophoneStream(handleAudioChunk, { sampleRate: 16000 });

  useEffect(() => {
    stopListeningRef.current = stopListening;
  }, [stopListening]);

  const handleError = useCallback(
    (message: ErrorMessage) => {
      logger.error('[VoiceMode] Error received:', message.code, message.message);

      let userFriendlyMessage = message.message;
      let canRetry = true;

      switch (message.code) {
        case 'BUFFER_OVERFLOW':
        case 'BUFFER_TIMEOUT':
          userFriendlyMessage = 'Audio buffer full. Please speak in shorter segments and try again.';
          canRetry = true;
          break;
        case 'TRANSCRIPTION_FAILED':
          userFriendlyMessage = 'Failed to transcribe audio. Please try speaking again.';
          canRetry = true;
          break;
        case 'RATE_LIMIT_EXCEEDED':
          userFriendlyMessage = 'Too many requests. Please wait a moment and try again.';
          canRetry = true;
          break;
        case 'CHUNK_SIZE_EXCEEDED':
          userFriendlyMessage = 'Audio chunk too large. Please speak in shorter segments.';
          canRetry = true;
          break;
        case 'INVALID_AUDIO_CHUNK':
        case 'AUDIO_PROCESSING_ERROR':
          userFriendlyMessage = 'Audio processing error. Please try again.';
          canRetry = true;
          break;
        default:
          userFriendlyMessage = message.message || 'An error occurred. Please try again.';
          canRetry = true;
      }

      setState((prev) => ({
        ...prev,
        error: userFriendlyMessage,
        errorCode: message.code,
        canRetry,
      }));

      if (micIsListening) {
        stopListening();
      }
    },
    [micIsListening, stopListening]
  );

  const clearError = useCallback(() => {
    setState((prev) => ({
      ...prev,
      error: null,
      errorCode: null,
      canRetry: false,
    }));
  }, []);

  const toggleListening = useCallback(() => {
    if (micIsListening) {
      if (wsClient.isConnected) {
        try {
          wsClient.send(
            JSON.stringify({
              type: 'client.speech_stopped',
              timestamp: Date.now(),
            })
          );
        } catch (err) {
          if (import.meta.env.DEV) {
            logger.warn('[VoiceMode] Error sending final chunk:', err);
          }
        }
      }

      stopListening();
      setState((prev) => ({ ...prev, isListening: false }));

      if (vadRef.current) {
        vadRef.current.reset();
      }
    } else {
      startListening();
      setState((prev) => ({ ...prev, isListening: true, error: null }));
    }
  }, [micIsListening, startListening, stopListening, wsClient]);

  useEffect(() => {
    if (!wsClient) {
      return;
    }

    const unsubscribeTranscript = wsClient.onMessage('transcript', handleTranscript);
    const unsubscribeError = wsClient.onMessage('error', handleError);

    return () => {
      unsubscribeTranscript();
      unsubscribeError();
    };
  }, [wsClient, handleTranscript, handleError]);

  useEffect(() => {
    if (micError) {
      let userFriendlyMessage = micError;
      let canRetry = false;

      if (
        micError.includes('Permission denied') ||
        micError.includes('NotAllowed') ||
        micError.includes('permission')
      ) {
        userFriendlyMessage =
          'Microphone access denied. Please grant permission in your browser settings and try again.';
        canRetry = false;
      } else if (micError.includes('NotFound') || micError.includes('not found')) {
        userFriendlyMessage = 'No microphone found. Please connect a microphone and try again.';
        canRetry = true;
      } else if (micError.includes('NotReadable') || micError.includes('in use')) {
        userFriendlyMessage =
          'Microphone is in use by another application. Please close other apps and try again.';
        canRetry = true;
      }

      setState((prev) => ({
        ...prev,
        error: userFriendlyMessage,
        errorCode: 'MICROPHONE_ERROR',
        canRetry,
      }));
    }
  }, [micError]);

  useEffect(() => {
    setState((prev) => ({ ...prev, isListening: micIsListening }));
  }, [micIsListening]);

  useEffect(() => {
    const connState = wsClient.connectionState;

    if (!wsClient.isConnected && micIsListening) {
      if (import.meta.env.DEV) {
        console.warn('[VoiceMode] WebSocket disconnected, stopping voice mode');
      }
      stopListening();

      const errorMsg =
        connState === 'reconnecting' ? 'Reconnecting to server\u2026' : 'Connection lost';

      setState((prev) => ({
        ...prev,
        isListening: false,
        error: errorMsg,
        errorCode: 'WEBSOCKET_DISCONNECTED',
        canRetry: connState !== 'reconnecting',
      }));
    }

    if (connState === 'reconnecting' && state.errorCode === 'WEBSOCKET_DISCONNECTED') {
      setState((prev) => ({
        ...prev,
        error: 'Reconnecting to server\u2026',
        canRetry: false,
      }));
    }

    if (wsClient.isConnected && state.errorCode === 'WEBSOCKET_DISCONNECTED') {
      if (import.meta.env.DEV) {
        logger.info('[VoiceMode] WebSocket reconnected, clearing error');
      }
      setState((prev) => ({
        ...prev,
        error: null,
        errorCode: null,
        canRetry: false,
      }));
    }
  }, [wsClient.isConnected, wsClient.connectionState, micIsListening, stopListening, state.errorCode]);

  useEffect(() => {
    return () => {
      if (vadRef.current) {
        vadRef.current.dispose();
      }
    };
  }, []);

  return {
    isListening: state.isListening,
    toggleListening,
    error: state.error,
    errorCode: state.errorCode,
    canRetry: state.canRetry,
    clearError,
  };
}

export default useVoiceMode;

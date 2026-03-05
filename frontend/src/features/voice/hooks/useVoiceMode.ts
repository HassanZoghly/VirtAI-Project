import { useState, useCallback, useRef, useEffect } from 'react';
import { useMicrophoneStream } from './useMicrophoneStream';
import { OptimizedVADProcessor } from '../audio/vadOptimized';

/**
 * Hook interface for voice mode management
 */
export interface VoiceModeHook {
    /** Whether voice mode is currently active and listening */
    isListening: boolean;
    /** Whether audio capture is paused (assistant speaking) */
    isPaused: boolean;
    /** Toggle voice mode on/off */
    toggleListening: () => void;
    /** Error message if voice mode fails */
    error: string | null;
    /** Error code for programmatic handling */
    errorCode: string | null;
    /** Whether the user can retry after an error */
    canRetry: boolean;
    /** Clear error state and allow retry */
    clearError: () => void;
}

/**
 * Internal state for voice mode
 */
interface VoiceModeState {
    isListening: boolean;
    isPaused: boolean;
    error: string | null;
    errorCode: string | null;
    canRetry: boolean;
}

/**
 * WebSocket client interface (subset needed for voice mode)
 */
interface WSClient {
    connectionState?: string;
    isConnected: boolean;
    send: (message: any) => void;
    onMessage: (type: string, handler: (data: any) => void) => () => void;
}

/**
 * Audio chunk message sent to backend (for control messages only)
 * Note: Actual audio data is sent via binary frames
 */
interface AudioChunkMessage {
    type: 'audio_chunk';
    is_final: boolean;       // true when silence detected
    timestamp: number;       // client timestamp (ms)
}

/**
 * Transcript message received from backend
 */
interface TranscriptMessage {
    type: 'transcript';
    session_id: string;
    text: string;
    confidence: number;
    language?: string;
    is_final: boolean;
}

/**
 * Error message received from backend
 */
interface ErrorMessage {
    type: 'error';
    code: string;
    message: string;
    session_id?: string;
    details?: any;
}

/**
 * Custom hook for voice mode orchestration
 * 
 * Integrates microphone capture, VAD, WebSocket communication, and echo prevention
 * to enable continuous voice conversations with the AI avatar.
 * 
 * Requirements: 1.5, 1.6, 2.7, 3.1, 3.2, 3.3, 3.4, 6.3, 7.1, 7.2, 7.3, 7.4, 7.5
 * 
 * @param wsClient - WebSocket client for sending/receiving messages
 * @param pipelineState - Current conversation pipeline state
 * @returns VoiceModeHook interface
 * 
 * @example
 * ```typescript
 * const wsClient = useWSClient('ws://localhost:8000/api/v1/ws');
 * const [conversation] = useConversationReducer();
 * const { isListening, isPaused, toggleListening, error } = useVoiceMode(
 *   wsClient,
 *   conversation.pipelineState
 * );
 * ```
 */
export function useVoiceMode(
    wsClient: WSClient,
    pipelineState: 'idle' | 'thinking' | 'speaking' | 'error'
): VoiceModeHook {
    const [state, setState] = useState<VoiceModeState>({
        isListening: false,
        isPaused: false,
        error: null,
        errorCode: null,
        canRetry: false,
    });

    // VAD instance (created once) - using optimized version
    const vadRef = useRef<OptimizedVADProcessor | null>(null);

    // Audio context for decoding audio blobs
    const audioContextRef = useRef<AudioContext | null>(null);

    // Track previous pipeline state for echo prevention
    const previousPipelineStateRef = useRef<string>(pipelineState);

    // Flag to prevent re-entrant auto-stop calls
    const autoStopInProgressRef = useRef<boolean>(false);

    // Ref to hold stopListening so handleAudioChunk can call it without stale closures
    const stopListeningRef = useRef<() => void>(() => {});

    /**
     * Initialize optimized VAD on first use
     * 
     * Uses OptimizedVADProcessor which:
     * - Automatically switches to Web Worker if processing exceeds 10ms
     * - Uses circular buffer to minimize allocations
     * - Batches WebSocket sends every 100ms
     * 
     * Requirements: 14.1, 14.2
     */
    if (vadRef.current === null) {
        vadRef.current = new OptimizedVADProcessor(
            {
                silenceThreshold: 0.01,
                silenceDuration: 800,
                minSpeechDuration: 300,
            },
            {
                enableWorker: true,
                batchInterval: 100, // Batch WebSocket sends every 100ms
                bufferCapacity: 100, // Circular buffer capacity
            }
        );
    }

    // Note: We do NOT register vadRef.onBatch here because handleAudioChunk
    // sends frames directly with VAD-informed markers. The batch path is unused.

    /**
     * Process audio chunk through VAD and send via WebSocket
     * 
     * Feeds audio through the VAD processor for silence detection, sends the
     * binary frame with the correct is_final marker, and triggers auto-stop
     * when VAD determines the user has finished speaking.
     * 
     * Requirements:
     * - 2.7: Process audio through VAD
     * - 2.4: Send raw PCM bytes via binary frames
     * - 14.1: VAD processing within 10ms (handled by OptimizedVADProcessor)
     * 
     * @param pcmData - Int16Array PCM audio chunk from microphone
     */
    const handleAudioChunk = useCallback((pcmData: Int16Array) => {
        // Skip if paused (echo prevention)
        if (state.isPaused) {
            return;
        }

        try {
            // Convert Int16 → Float32 for VAD analysis
            const float32Data = new Float32Array(pcmData.length);
            for (let i = 0; i < pcmData.length; i++) {
                float32Data[i] = pcmData[i] / (pcmData[i] < 0 ? 0x8000 : 0x7FFF);
            }

            // Run VAD to detect speech/silence
            const vadResult = vadRef.current!.processAudioChunk(float32Data);
            const isFinal = vadResult.shouldFinalize;

            // Send PCM bytes with VAD-informed is_final marker via binary frame
            if (wsClient.isConnected) {
                const pcmBytes = new Uint8Array(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength);
                const frame = new Uint8Array(pcmBytes.byteLength + 1);
                frame.set(pcmBytes, 0);
                frame[pcmBytes.byteLength] = isFinal ? 0x01 : 0x00;

                wsClient.send(frame.buffer);
            }

            // Auto-stop when VAD detects silence after speech
            if (isFinal && !autoStopInProgressRef.current) {
                autoStopInProgressRef.current = true;

                if (import.meta.env.DEV) {
                    console.log('[VoiceMode] VAD detected silence after speech — auto-stopping');
                }

                // Send final JSON control message (same as manual stop)
                if (wsClient.isConnected) {
                    const finalMessage: AudioChunkMessage = {
                        type: 'audio_chunk',
                        is_final: true,
                        timestamp: Date.now(),
                    };
                    wsClient.send(finalMessage);
                }

                // Stop microphone and reset state
                stopListeningRef.current();
                setState(prev => ({ ...prev, isListening: false }));
                vadRef.current!.reset();
                autoStopInProgressRef.current = false;
            }
        } catch (err) {
            console.error('[VoiceMode] Failed to process audio chunk:', err);
        }
    }, [state.isPaused, wsClient]);

    /**
     * Handle transcript messages from backend
     * 
     * Requirements:
     * - 6.3: Display transcribed text in UI
     * 
     * Note: The actual UI display is handled by the parent component
     * This hook just logs the transcript for now
     */
    const handleTranscript = useCallback((message: TranscriptMessage) => {
        if (import.meta.env.DEV) {
            console.log('[VoiceMode] Transcript received:', message.text);
        }
        // Parent component will handle displaying the transcript
        // by listening to the same WebSocket message
    }, []);

    /**
     * Microphone stream hook
     */
    const { isListening: micIsListening, startListening, stopListening, error: micError } =
        useMicrophoneStream(handleAudioChunk, { sampleRate: 16000 });

    // Keep ref in sync so handleAudioChunk can call stopListening without stale closure
    stopListeningRef.current = stopListening;

    /**
     * Handle error messages from backend
     * 
     * Requirements:
     * - 8.2: Handle microphone permission denied
     * - 8.3: Display error messages in UI
     * - 9.4: Handle buffer overflow errors
     * - 10.5: Handle transcription failure errors
     * - 11.3: Handle WebSocket disconnection
     * 
     * @param message - Error message from backend
     */
    const handleError = useCallback((message: ErrorMessage) => {
        console.error('[VoiceMode] Error received:', message.code, message.message);

        let userFriendlyMessage = message.message;
        let canRetry = true;

        // Customize error messages based on error code
        switch (message.code) {
            case 'BUFFER_OVERFLOW':
            case 'BUFFER_TIMEOUT':
                // Requirements: 9.4 - Buffer overflow with suggestion
                userFriendlyMessage = 'Audio buffer full. Please speak in shorter segments and try again.';
                canRetry = true;
                break;

            case 'TRANSCRIPTION_FAILED':
                // Requirements: 10.5 - Transcription failure with retry option
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
                // Use the backend message as-is for unknown errors
                userFriendlyMessage = message.message || 'An error occurred. Please try again.';
                canRetry = true;
        }

        setState(prev => ({
            ...prev,
            error: userFriendlyMessage,
            errorCode: message.code,
            canRetry,
        }));

        // Stop listening on error
        if (micIsListening) {
            stopListening();
        }
    }, [micIsListening, stopListening]);

    /**
     * Clear error state and allow retry
     * 
     * Requirements:
     * - 10.5: Allow user to retry after error
     */
    const clearError = useCallback(() => {
        setState(prev => ({
            ...prev,
            error: null,
            errorCode: null,
            canRetry: false,
        }));
    }, []);

    /**
     * Toggle voice mode on/off
     * 
     * Requirements:
     * - 1.5: Set isListening state to true when starting
     * - 1.6: Set isListening state to false when stopping
     */
    const toggleListening = useCallback(() => {
        if (micIsListening) {
            // Send final chunk before stopping
            const finalMessage: AudioChunkMessage = {
                type: 'audio_chunk',
                is_final: true,
                timestamp: Date.now(),
            };

            if (wsClient.isConnected) {
                try {
                    wsClient.send(finalMessage);
                    if (import.meta.env.DEV) {
                        console.log('[VoiceMode] Sent final chunk on stop');
                    }
                } catch (err) {
                    if (import.meta.env.DEV) {
                        console.warn('[VoiceMode] Error sending final chunk:', err);
                    }
                }
            }

            // Stop listening
            stopListening();
            setState(prev => ({ ...prev, isListening: false }));

            // Reset VAD state
            if (vadRef.current) {
                vadRef.current.reset();
            }
        } else {
            // Start listening
            startListening();
            setState(prev => ({ ...prev, isListening: true, error: null }));
        }
    }, [micIsListening, startListening, stopListening, wsClient]);

    /**
     * Echo prevention: pause/resume audio capture based on pipeline state
     * 
     * Requirements:
     * - 7.1: Pause audio recording when pipeline state is 'speaking'
     * - 7.2: Set isPaused state to true when paused
     * - 7.3: Resume audio recording when pipeline state transitions from 'speaking' to 'idle'
     * - 7.4: Set isPaused state to false when resumed
     * - 7.5: Do not send audio chunks when paused
     */
    useEffect(() => {
        const previousState = previousPipelineStateRef.current;
        const currentState = pipelineState;

        // Detect transition to 'speaking' (Requirement 7.1)
        if (currentState === 'speaking' && previousState !== 'speaking') {
            if (micIsListening) {
                setState(prev => ({ ...prev, isPaused: true })); // Requirement 7.2
                if (import.meta.env.DEV) {
                    console.log('[VoiceMode] Audio capture paused - assistant speaking');
                }
            }
        }

        // Detect transition from 'speaking' to 'idle' (Requirement 7.3)
        if (previousState === 'speaking' && currentState === 'idle') {
            if (micIsListening) {
                setState(prev => ({ ...prev, isPaused: false })); // Requirement 7.4
                if (import.meta.env.DEV) {
                    console.log('[VoiceMode] Audio capture resumed - assistant finished');
                }
            }
        }

        // Update previous state
        previousPipelineStateRef.current = currentState;
    }, [pipelineState, micIsListening]);

    /**
     * Register transcript and error message handlers
     * 
     * Requirements:
     * - 6.3: Handle transcript messages
     * - 8.3, 9.4, 10.5: Handle error messages
     */
    useEffect(() => {
        if (!wsClient) return;

        const unsubscribeTranscript = wsClient.onMessage('transcript', handleTranscript);
        const unsubscribeError = wsClient.onMessage('error', handleError);

        return () => {
            unsubscribeTranscript();
            unsubscribeError();
        };
    }, [wsClient, handleTranscript, handleError]);

    /**
     * Sync microphone error to voice mode state
     * 
     * Requirements:
     * - 8.2: Handle microphone permission denied with user-friendly message
     * - 8.3: Display error messages in UI
     */
    useEffect(() => {
        if (micError) {
            let userFriendlyMessage = micError;
            let canRetry = false;

            // Customize microphone permission error message
            if (micError.includes('Permission denied') ||
                micError.includes('NotAllowed') ||
                micError.includes('permission')) {
                // Requirements: 8.2 - Microphone permission denied with instructions
                userFriendlyMessage =
                    'Microphone access denied. Please grant permission in your browser settings and try again.';
                canRetry = false; // User must manually grant permission
            } else if (micError.includes('NotFound') || micError.includes('not found')) {
                userFriendlyMessage = 'No microphone found. Please connect a microphone and try again.';
                canRetry = true;
            } else if (micError.includes('NotReadable') || micError.includes('in use')) {
                userFriendlyMessage = 'Microphone is in use by another application. Please close other apps and try again.';
                canRetry = true;
            }

            setState(prev => ({
                ...prev,
                error: userFriendlyMessage,
                errorCode: 'MICROPHONE_ERROR',
                canRetry,
            }));
        }
    }, [micError]);

    /**
     * Sync microphone listening state to voice mode state
     */
    useEffect(() => {
        setState(prev => ({ ...prev, isListening: micIsListening }));
    }, [micIsListening]);

    /**
     * Handle WebSocket disconnection during voice mode
     * 
     * Requirements:
     * - 11.1: Stop recording when WebSocket disconnects
     * - 11.3: Set isListening to false on disconnection
     * - 11.5: Display reconnection status in UI
     */
    useEffect(() => {
        const connState = wsClient.connectionState;

        // If WebSocket disconnects while listening, stop voice mode
        if (!wsClient.isConnected && micIsListening) {
            if (import.meta.env.DEV) {
                console.warn('[VoiceMode] WebSocket disconnected, stopping voice mode');
            }
            stopListening();

            const errorMsg = connState === 'reconnecting'
                ? 'Reconnecting to server\u2026'
                : 'Connection lost';

            setState(prev => ({
                ...prev,
                isListening: false,
                error: errorMsg,
                errorCode: 'WEBSOCKET_DISCONNECTED',
                canRetry: connState !== 'reconnecting',
            }));
        }

        // Update error message while reconnecting
        if (connState === 'reconnecting' && state.errorCode === 'WEBSOCKET_DISCONNECTED') {
            setState(prev => ({
                ...prev,
                error: 'Reconnecting to server\u2026',
                canRetry: false,
            }));
        }

        // Clear disconnection error when fully online
        if (wsClient.isConnected && state.errorCode === 'WEBSOCKET_DISCONNECTED') {
            if (import.meta.env.DEV) {
                console.log('[VoiceMode] WebSocket reconnected, clearing error');
            }
            setState(prev => ({
                ...prev,
                error: null,
                errorCode: null,
                canRetry: false,
            }));
        }
    }, [wsClient.isConnected, wsClient.connectionState, micIsListening, stopListening, state.errorCode]);

    /**
     * Cleanup on unmount
     */
    useEffect(() => {
        return () => {
            // Dispose optimized VAD processor
            if (vadRef.current) {
                vadRef.current.dispose();
            }
            // Close audio context
            if (audioContextRef.current) {
                audioContextRef.current.close().catch(() => {});
            }
        };
    }, []);

    return {
        isListening: state.isListening,
        isPaused: state.isPaused,
        toggleListening,
        error: state.error,
        errorCode: state.errorCode,
        canRetry: state.canRetry,
        clearError,
    };
}

export default useVoiceMode;

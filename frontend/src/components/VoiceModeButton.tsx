import { useMemo } from 'react';
import { PiMicrophoneFill, PiPauseFill, PiWarningCircleFill } from 'react-icons/pi';
import { useVoiceMode } from '../hooks/useVoiceMode';
import './VoiceModeButton.css';

/**
 * Props for VoiceModeButton component
 */
interface VoiceModeButtonProps {
  /** WebSocket client for voice mode communication */
  wsClient: any;
  /** Current conversation pipeline state */
  pipelineState: 'idle' | 'thinking' | 'speaking' | 'error';
  /** Optional CSS class name */
  className?: string;
}

/**
 * VoiceModeButton Component
 * 
 * A button component that enables continuous voice mode interaction with the AI avatar.
 * Displays microphone button with listening/idle states, pause indicator when assistant
 * is speaking, error messages, and visual feedback for voice activity.
 * 
 * Requirements: 1.1, 1.4, 6.3, 7.2, 8.3, 8.4, 8.5
 * 
 * @param props - Component props
 * @returns VoiceModeButton component
 * 
 * @example
 * ```tsx
 * <VoiceModeButton 
 *   wsClient={wsClient} 
 *   pipelineState={conversation.pipelineState}
 * />
 * ```
 */
export default function VoiceModeButton({
  wsClient,
  pipelineState,
  className = '',
}: VoiceModeButtonProps) {
  // Use voice mode hook (Requirement 1.1, 1.4)
  const { isListening, isPaused, toggleListening, error, errorCode, canRetry, clearError } = useVoiceMode(
    wsClient,
    pipelineState
  );

  // Determine button state and styling
  const buttonState = useMemo(() => {
    if (error) return 'error';
    if (isPaused) return 'paused';
    if (isListening) return 'listening';
    return 'idle';
  }, [isListening, isPaused, error]);

  // Determine button icon
  const ButtonIcon = useMemo(() => {
    if (error) return PiWarningCircleFill;
    if (isPaused) return PiPauseFill;
    return PiMicrophoneFill;
  }, [error, isPaused]);

  // Determine button title/tooltip
  const buttonTitle = useMemo(() => {
    if (error) return `Voice mode error: ${error}`;
    if (isPaused) return 'Voice paused (assistant speaking)';
    if (isListening) return 'Stop voice mode';
    return 'Start voice mode';
  }, [isListening, isPaused, error]);

  // Determine button aria-label
  const ariaLabel = useMemo(() => {
    if (error) return 'Voice mode error';
    if (isPaused) return 'Voice mode paused';
    if (isListening) return 'Stop voice mode';
    return 'Start voice mode';
  }, [isListening, isPaused, error]);

  // Get user-friendly error message with instructions
  const errorDisplay = useMemo(() => {
    if (!error) return null;

    let message = error;
    let instruction = '';

    // Add specific instructions based on error code
    switch (errorCode) {
      case 'MICROPHONE_ERROR':
        if (error.includes('denied') || error.includes('permission')) {
          instruction = 'Go to browser settings → Privacy → Microphone and allow access.';
        }
        break;
      case 'BUFFER_OVERFLOW':
      case 'BUFFER_TIMEOUT':
        instruction = 'Try speaking in shorter sentences (5-10 seconds at a time).';
        break;
      case 'TRANSCRIPTION_FAILED':
        instruction = 'Check your internet connection and try again.';
        break;
      case 'WEBSOCKET_DISCONNECTED':
        instruction = 'Waiting for connection to restore...';
        break;
    }

    return { message, instruction };
  }, [error, errorCode]);

  return (
    <div className={`voice-mode-container ${className}`}>
      {/* Main voice mode button (Requirement 1.1, 1.4) */}
      <button
        className={`voice-mode-btn ${buttonState}`}
        onClick={toggleListening}
        title={buttonTitle}
        aria-label={ariaLabel}
        disabled={!!error}
        type="button"
      >
        <ButtonIcon className="voice-mode-icon" />
        
        {/* Listening animation (Requirement 8.3) */}
        {isListening && !isPaused && (
          <span className="voice-activity-indicator">
            <span className="pulse-ring" />
            <span className="pulse-ring pulse-ring-delay" />
          </span>
        )}
      </button>

      {/* Paused indicator (Requirement 7.2, 8.4) */}
      {isPaused && (
        <div className="voice-status-indicator paused" role="status" aria-live="polite">
          <PiPauseFill className="status-icon" />
          <span className="status-text">Paused (assistant speaking)</span>
        </div>
      )}

      {/* Error message display (Requirement 8.3, 8.4, 8.5, 9.4, 10.5, 11.5) */}
      {error && errorDisplay && (
        <div className="voice-status-indicator error" role="alert" aria-live="assertive">
          <PiWarningCircleFill className="status-icon" />
          <div className="status-content">
            <span className="status-text">{errorDisplay.message}</span>
            {errorDisplay.instruction && (
              <span className="status-instruction">{errorDisplay.instruction}</span>
            )}
            {canRetry && (
              <button
                className="retry-button"
                onClick={() => {
                  clearError();
                  toggleListening();
                }}
                type="button"
                aria-label="Retry voice mode"
              >
                Try Again
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

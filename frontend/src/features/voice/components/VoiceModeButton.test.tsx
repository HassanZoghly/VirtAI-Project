import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VoiceModeButton from './VoiceModeButton';
import * as useRealtimeASRModule from '../hooks/useRealtimeASR';

// Mock the useRealtimeASR hook
vi.mock('../hooks/useRealtimeASR', () => ({
  useRealtimeASR: vi.fn(),
}));

const mockStartListening = vi.fn();
const mockStopListening = vi.fn();

/** Helper: default mock return for useRealtimeASR */
function defaultASRReturn(overrides = {}) {
  return {
    isListening: false,
    isPaused: false,
    isProcessing: false,
    interimText: '',
    finalText: '',
    error: null,
    errorCode: null,
    canRetry: false,
    clearError: vi.fn(),
    startListening: mockStartListening,
    stopListening: mockStopListening,
    resetTranscript: vi.fn(),
    ...overrides,
  };
}

describe('VoiceModeButton', () => {
  const mockWsClient = {
    isConnected: true,
    send: vi.fn(),
    onMessage: vi.fn(() => vi.fn()),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders idle state correctly', () => {
    vi.mocked(useRealtimeASRModule.useRealtimeASR).mockReturnValue(defaultASRReturn());

    render(<VoiceModeButton wsClient={mockWsClient} pipelineState="idle" />);

    const button = screen.getByRole('button', { name: /start voice mode/i });
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();
    expect(button).toHaveClass('voice-mode-btn', 'idle');
  });

  it('renders listening state with activity indicator', () => {
    vi.mocked(useRealtimeASRModule.useRealtimeASR).mockReturnValue(
      defaultASRReturn({ isListening: true })
    );

    render(<VoiceModeButton wsClient={mockWsClient} pipelineState="idle" />);

    const button = screen.getByRole('button', { name: /stop voice mode/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass('voice-mode-btn', 'listening');

    // Check for voice activity indicator
    const activityIndicator = document.querySelector('.voice-activity-indicator');
    expect(activityIndicator).toBeInTheDocument();
  });

  it('renders processing state when processing and listening', () => {
    vi.mocked(useRealtimeASRModule.useRealtimeASR).mockReturnValue(
      defaultASRReturn({ isListening: true, isProcessing: true })
    );

    render(<VoiceModeButton wsClient={mockWsClient} pipelineState="idle" />);

    const button = screen.getByRole('button', { name: /stop voice mode/i });
    expect(button).toHaveClass('voice-mode-btn', 'processing');
  });

  it('renders paused state with indicator', () => {
    vi.mocked(useRealtimeASRModule.useRealtimeASR).mockReturnValue(
      defaultASRReturn({ isListening: true, isPaused: true })
    );

    render(<VoiceModeButton wsClient={mockWsClient} pipelineState="speaking" />);

    const button = screen.getByRole('button', { name: /voice mode paused/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass('voice-mode-btn', 'paused');

    // Check for paused status indicator
    const statusIndicator = screen.getByRole('status');
    expect(statusIndicator).toBeInTheDocument();
    expect(statusIndicator).toHaveTextContent(/paused.*assistant speaking/i);
  });

  it('renders error state with error message', () => {
    const errorMessage = 'Audio capture failed';
    vi.mocked(useRealtimeASRModule.useRealtimeASR).mockReturnValue(
      defaultASRReturn({ error: errorMessage })
    );

    render(<VoiceModeButton wsClient={mockWsClient} pipelineState="error" />);

    const button = screen.getByRole('button', { name: /voice mode error/i });
    expect(button).toBeInTheDocument();
    expect(button).toBeDisabled();
    expect(button).toHaveClass('voice-mode-btn', 'error');

    // Check for error alert
    const errorAlert = screen.getByRole('alert');
    expect(errorAlert).toBeInTheDocument();
    expect(errorAlert).toHaveTextContent(/audio capture failed/i);
  });

  it('displays instruction for permission denied via errorCode', () => {
    vi.mocked(useRealtimeASRModule.useRealtimeASR).mockReturnValue(
      defaultASRReturn({
        error: 'Microphone access denied',
        errorCode: 'MICROPHONE_ERROR',
      })
    );

    render(<VoiceModeButton wsClient={mockWsClient} pipelineState="idle" />);

    const errorAlert = screen.getByRole('alert');
    expect(errorAlert).toHaveTextContent(/microphone access denied/i);
  });

  it('calls startListening when idle button is clicked', () => {
    vi.mocked(useRealtimeASRModule.useRealtimeASR).mockReturnValue(defaultASRReturn());

    render(<VoiceModeButton wsClient={mockWsClient} pipelineState="idle" />);

    const button = screen.getByRole('button', { name: /start voice mode/i });
    fireEvent.click(button);

    expect(mockStartListening).toHaveBeenCalledTimes(1);
  });

  it('calls stopListening when listening button is clicked', () => {
    vi.mocked(useRealtimeASRModule.useRealtimeASR).mockReturnValue(
      defaultASRReturn({ isListening: true })
    );

    render(<VoiceModeButton wsClient={mockWsClient} pipelineState="idle" />);

    const button = screen.getByRole('button', { name: /stop voice mode/i });
    fireEvent.click(button);

    expect(mockStopListening).toHaveBeenCalledTimes(1);
  });

  it('does not call startListening when button is disabled due to error', () => {
    vi.mocked(useRealtimeASRModule.useRealtimeASR).mockReturnValue(
      defaultASRReturn({ error: 'Some error' })
    );

    render(<VoiceModeButton wsClient={mockWsClient} pipelineState="error" />);

    const button = screen.getByRole('button', { name: /voice mode error/i });
    fireEvent.click(button);

    expect(mockStartListening).not.toHaveBeenCalled();
    expect(mockStopListening).not.toHaveBeenCalled();
  });

  it('applies custom className when provided', () => {
    vi.mocked(useRealtimeASRModule.useRealtimeASR).mockReturnValue(defaultASRReturn());

    const { container } = render(
      <VoiceModeButton wsClient={mockWsClient} pipelineState="idle" className="custom-class" />
    );

    const voiceContainer = container.querySelector('.voice-mode-container');
    expect(voiceContainer).toHaveClass('custom-class');
  });

  it('does not show activity indicator when paused', () => {
    vi.mocked(useRealtimeASRModule.useRealtimeASR).mockReturnValue(
      defaultASRReturn({ isListening: true, isPaused: true })
    );

    render(<VoiceModeButton wsClient={mockWsClient} pipelineState="speaking" />);

    // Activity indicator should not be present when paused
    const activityIndicator = document.querySelector('.voice-activity-indicator');
    expect(activityIndicator).not.toBeInTheDocument();
  });

  it('shows transcript bubble when interimText is present', () => {
    vi.mocked(useRealtimeASRModule.useRealtimeASR).mockReturnValue(
      defaultASRReturn({ isListening: true, interimText: 'Hello world' })
    );

    render(<VoiceModeButton wsClient={mockWsClient} pipelineState="idle" />);

    const bubble = document.querySelector('.voice-transcript-bubble');
    expect(bubble).toBeInTheDocument();
    expect(bubble).toHaveTextContent('Hello world');
  });

  it('does not show transcript bubble when interimText is empty', () => {
    vi.mocked(useRealtimeASRModule.useRealtimeASR).mockReturnValue(
      defaultASRReturn({ isListening: true, interimText: '' })
    );

    render(<VoiceModeButton wsClient={mockWsClient} pipelineState="idle" />);

    const bubble = document.querySelector('.voice-transcript-bubble');
    expect(bubble).not.toBeInTheDocument();
  });

  it('has correct accessibility attributes', () => {
    vi.mocked(useRealtimeASRModule.useRealtimeASR).mockReturnValue(defaultASRReturn());

    render(<VoiceModeButton wsClient={mockWsClient} pipelineState="idle" />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-label', 'Start voice mode');
    expect(button).toHaveAttribute('title', 'Start voice mode');
    expect(button).toHaveAttribute('type', 'button');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VoiceModeButton from './VoiceModeButton';
import * as useVoiceModeModule from '../hooks/useVoiceMode';

// Mock the useVoiceMode hook
vi.mock('../hooks/useVoiceMode', () => ({
  useVoiceMode: vi.fn(),
}));

describe('VoiceModeButton', () => {
  const mockWsClient = {
    isConnected: true,
    send: vi.fn(),
    onMessage: vi.fn(() => vi.fn()),
  };

  const mockToggleListening = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders idle state correctly', () => {
    vi.mocked(useVoiceModeModule.useVoiceMode).mockReturnValue({
      isListening: false,
      isPaused: false,
      toggleListening: mockToggleListening,
      error: null,
    });

    render(<VoiceModeButton wsClient={mockWsClient} pipelineState="idle" />);

    const button = screen.getByRole('button', { name: /start voice mode/i });
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();
    expect(button).toHaveClass('voice-mode-btn', 'idle');
  });

  it('renders listening state with activity indicator', () => {
    vi.mocked(useVoiceModeModule.useVoiceMode).mockReturnValue({
      isListening: true,
      isPaused: false,
      toggleListening: mockToggleListening,
      error: null,
    });

    render(<VoiceModeButton wsClient={mockWsClient} pipelineState="idle" />);

    const button = screen.getByRole('button', { name: /stop voice mode/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass('voice-mode-btn', 'listening');

    // Check for voice activity indicator
    const activityIndicator = document.querySelector('.voice-activity-indicator');
    expect(activityIndicator).toBeInTheDocument();
  });

  it('renders paused state with indicator', () => {
    vi.mocked(useVoiceModeModule.useVoiceMode).mockReturnValue({
      isListening: true,
      isPaused: true,
      toggleListening: mockToggleListening,
      error: null,
    });

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
    vi.mocked(useVoiceModeModule.useVoiceMode).mockReturnValue({
      isListening: false,
      isPaused: false,
      toggleListening: mockToggleListening,
      error: errorMessage,
    });

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

  it('displays user-friendly message for permission denied errors', () => {
    vi.mocked(useVoiceModeModule.useVoiceMode).mockReturnValue({
      isListening: false,
      isPaused: false,
      toggleListening: mockToggleListening,
      error: 'NotAllowedError: Permission denied',
    });

    render(<VoiceModeButton wsClient={mockWsClient} pipelineState="idle" />);

    const errorAlert = screen.getByRole('alert');
    expect(errorAlert).toHaveTextContent(
      /microphone access denied.*grant permission in your browser settings/i
    );
  });

  it('calls toggleListening when button is clicked', () => {
    vi.mocked(useVoiceModeModule.useVoiceMode).mockReturnValue({
      isListening: false,
      isPaused: false,
      toggleListening: mockToggleListening,
      error: null,
    });

    render(<VoiceModeButton wsClient={mockWsClient} pipelineState="idle" />);

    const button = screen.getByRole('button', { name: /start voice mode/i });
    fireEvent.click(button);

    expect(mockToggleListening).toHaveBeenCalledTimes(1);
  });

  it('does not call toggleListening when button is disabled due to error', () => {
    vi.mocked(useVoiceModeModule.useVoiceMode).mockReturnValue({
      isListening: false,
      isPaused: false,
      toggleListening: mockToggleListening,
      error: 'Some error',
    });

    render(<VoiceModeButton wsClient={mockWsClient} pipelineState="error" />);

    const button = screen.getByRole('button', { name: /voice mode error/i });
    fireEvent.click(button);

    expect(mockToggleListening).not.toHaveBeenCalled();
  });

  it('applies custom className when provided', () => {
    vi.mocked(useVoiceModeModule.useVoiceMode).mockReturnValue({
      isListening: false,
      isPaused: false,
      toggleListening: mockToggleListening,
      error: null,
    });

    const { container } = render(
      <VoiceModeButton
        wsClient={mockWsClient}
        pipelineState="idle"
        className="custom-class"
      />
    );

    const voiceContainer = container.querySelector('.voice-mode-container');
    expect(voiceContainer).toHaveClass('custom-class');
  });

  it('does not show activity indicator when paused', () => {
    vi.mocked(useVoiceModeModule.useVoiceMode).mockReturnValue({
      isListening: true,
      isPaused: true,
      toggleListening: mockToggleListening,
      error: null,
    });

    render(<VoiceModeButton wsClient={mockWsClient} pipelineState="speaking" />);

    // Activity indicator should not be present when paused
    const activityIndicator = document.querySelector('.voice-activity-indicator');
    expect(activityIndicator).not.toBeInTheDocument();
  });

  it('has correct accessibility attributes', () => {
    vi.mocked(useVoiceModeModule.useVoiceMode).mockReturnValue({
      isListening: false,
      isPaused: false,
      toggleListening: mockToggleListening,
      error: null,
    });

    render(<VoiceModeButton wsClient={mockWsClient} pipelineState="idle" />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-label', 'Start voice mode');
    expect(button).toHaveAttribute('title', 'Start voice mode');
    expect(button).toHaveAttribute('type', 'button');
  });
});

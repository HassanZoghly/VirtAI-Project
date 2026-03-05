import { useCallback } from 'react';
import { PiPaperclipFill, PiPaperPlaneTiltFill } from 'react-icons/pi';
import VoiceModeButton from '../../voice/components/VoiceModeButton';

const MAX_CHARS = 2000;

/**
 * Chat input bar with textarea, send button, voice mode toggle, and attachment stub.
 * @param {object} props
 * @param {string} props.inputValue - Current textarea value
 * @param {(value: string) => void} props.onInputChange - Text change callback
 * @param {() => void} props.onSend - Send button callback
 * @param {(e: React.KeyboardEvent) => void} props.onKeyDown - Keyboard handler (Enter to send)
 * @param {React.RefObject<HTMLTextAreaElement>} props.textareaRef - Textarea element ref
 * @param {'online'|'offline'|'checking'} props.backendStatus - Server connection status
 * @param {object} props.wsClient - WebSocket client instance
 * @param {string} props.pipelineState - Current pipeline state
 */
export default function ChatInput({
  inputValue,
  onInputChange,
  onSend,
  onKeyDown,
  textareaRef,
  backendStatus,
  wsClient,
  pipelineState,
}) {
  const handleChange = useCallback(
    (e) => {
      onInputChange(e.target.value);
      e.target.style.height = 'auto';
      e.target.style.height = `${e.target.scrollHeight}px`;
    },
    [onInputChange],
  );

  return (
    <div className="chat-input-wrapper">
      <div className="chat-input-bar">
        <button className="input-icon-btn" title="Attach file" type="button" disabled aria-label="Attach file">
          <PiPaperclipFill />
        </button>

        {/* Voice Mode Button - Requirements 1.1, 1.4 */}
        <div style={{ marginBottom: '4px' }}>
          <VoiceModeButton
            wsClient={wsClient}
            pipelineState={pipelineState}
          />
        </div>

        <textarea
          ref={textareaRef}
          className="chat-input"
          aria-label="Message input"
          placeholder={
            backendStatus === 'offline' ? 'Type a message (offline mode)…' : 'Type a message…'
          }
          value={inputValue}
          onChange={handleChange}
          onKeyDown={onKeyDown}
          rows={1}
          maxLength={MAX_CHARS}
        />

        <button
          className="send-btn"
          onClick={onSend}
          title="Send message"
          aria-label="Send message"
          type="button"
          disabled={!inputValue.trim()}
          style={{ opacity: inputValue.trim() ? 1 : 0.5 }}
        >
          <PiPaperPlaneTiltFill />
        </button>
      </div>

      {inputValue.length > 0 && (
        <div className={`char-count${inputValue.length >= MAX_CHARS ? ' char-count--limit' : ''}`}>
          {inputValue.length}/{MAX_CHARS}
        </div>
      )}
    </div>
  );
}

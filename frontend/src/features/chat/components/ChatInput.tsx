import React, { useCallback, KeyboardEvent, useRef, useEffect } from 'react';
import { PiPaperclipFill, PiPaperPlaneTiltFill } from 'react-icons/pi';
import VoiceModeButton from '../../voice/components/VoiceModeButton';

const MAX_CHARS = 2000;

interface ChatInputProps {
  inputValue: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  backendStatus: 'online' | 'offline' | 'checking';
  wsClient: any;
  pipelineState: 'idle' | 'thinking' | 'speaking' | 'error';
  onToggleDocuments: () => void;
  onBeforeVoiceStart?: () => Promise<boolean> | boolean;
  onStop?: () => void;
}

export default function ChatInput({
  inputValue,
  onInputChange,
  onSend,
  onKeyDown,
  textareaRef,
  backendStatus,
  wsClient,
  pipelineState,
  onToggleDocuments,
  onBeforeVoiceStart,
  onStop,
}: ChatInputProps) {
  const requestRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const el = e.target;
      onInputChange(el.value);
      
      const hardcodedMaxHeight = 150;
      
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
      requestRef.current = requestAnimationFrame(() => {
        el.style.height = 'auto';
        const nextHeight = Math.min(el.scrollHeight, hardcodedMaxHeight);
        
        el.style.height = `${nextHeight}px`;

        const shouldScroll = el.scrollHeight > hardcodedMaxHeight + 1;
        el.classList.toggle('is-scrollable', shouldScroll);
        el.style.overflowY = shouldScroll ? 'auto' : 'hidden';
      });
    },
    [onInputChange]
  );

  return (
    <div className="chat-input-wrapper">
      <div className="chat-input-bar">
        <button
          className="input-icon-btn"
          title="Manage Knowledge Base"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleDocuments();
          }}
          aria-label="Manage Knowledge Base"
        >
          <PiPaperclipFill />
        </button>

        <div style={{ marginBottom: '4px' }}>
          <VoiceModeButton
            wsClient={wsClient}
            pipelineState={pipelineState}
            onBeforeStart={onBeforeVoiceStart}
          />
        </div>

        {pipelineState === 'speaking' && (
          <button
            className="stop-btn flex items-center gap-2 bg-red-500/20 text-red-500 hover:bg-red-500/30 rounded-full px-4 py-1.5 font-medium text-sm transition-colors mr-2"
            onClick={onStop}
            title="Stop Generating"
            type="button"
          >
            <div className="w-2.5 h-2.5 bg-red-500 rounded-sm" />
            Stop
          </button>
        )}

        <textarea
          ref={textareaRef}
          className="chat-input chat-input-textarea"
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

      <div
        className={`char-count${inputValue.length >= MAX_CHARS ? ' char-count--limit' : ''}`}
        style={{
          visibility: inputValue.length > 0 ? 'visible' : 'hidden',
          opacity: inputValue.length > 0 ? 1 : 0,
        }}
      >
        {inputValue.length}/{MAX_CHARS}
      </div>
    </div>
  );
}

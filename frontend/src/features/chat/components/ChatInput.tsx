import React, { KeyboardEvent, useCallback, useEffect, useRef } from 'react';
import { FiSquare } from 'react-icons/fi';
import { PiPaperclip, PiPaperPlaneTiltFill } from 'react-icons/pi';
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

  const isGenerating = ['thinking', 'speaking'].includes(pipelineState);

  return (
    <div className="chat-input-container w-full px-4 mb-4" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
      <div className="flex flex-row items-end gap-3 max-w-[800px] mx-auto w-full">
        {/* Left Action Buttons */}
        <div className="flex flex-row items-end gap-2">
          <VoiceModeButton
            className="flex items-center justify-center"
            wsClient={wsClient}
            pipelineState={pipelineState}
            onBeforeStart={onBeforeVoiceStart}
          />
          <button
            className="w-[52px] h-[52px] rounded-full bg-[#1e1e1e] hover:bg-[#2a2a2a] flex items-center justify-center transition-colors text-white/70 hover:text-white"
            title="Manage Knowledge Base"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleDocuments();
            }}
            aria-label="Manage Knowledge Base"
          >
            <PiPaperclip size={22} />
          </button>
        </div>

        {/* Input Pill */}
        <div className="chat-input-pill flex-1 flex flex-row items-end gap-2.5 rounded-[26px] bg-[#2a2a2a] px-4 py-1 transition-all duration-300 min-h-[52px]">
          <textarea
            ref={textareaRef}
            className="flex-1 bg-transparent border-none outline-none focus:ring-0 focus:border-none focus:outline-none focus:shadow-none resize-none text-[15px] text-white/90 placeholder:text-white/40 py-3 min-h-[44px] max-h-[132px]"
            aria-label="Message input"
            placeholder={
              backendStatus === 'offline' ? 'Type your message (offline mode)…' : 'Type your message...'
            }
            value={inputValue}
            onChange={handleChange}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={MAX_CHARS}
            style={{ overflowY: 'auto', outline: 'none', boxShadow: 'none' }}
          />

          {isGenerating ? (
            <button
              className="w-10 h-10 rounded-full flex items-center justify-center bg-red-500/90 text-white self-end mb-0.5 hover:bg-red-500 transition-all animate-pulse"
              onClick={onStop}
              title="Stop Generating"
              type="button"
              aria-label="Stop generation"
            >
              <FiSquare fill="currentColor" size={16} />
            </button>
          ) : (
            <button
              className="w-10 h-10 rounded-full flex items-center justify-center bg-[#cda473] text-white self-end mb-0.5 hover:bg-[#b89163] transition-colors disabled:opacity-50 disabled:bg-white/10 disabled:text-white/30"
              onClick={onSend}
              title="Send message"
              aria-label="Send message"
              type="button"
              disabled={!inputValue.trim()}
            >
              <PiPaperPlaneTiltFill size={18} />
            </button>
          )}
        </div>
      </div>
      <div
        className={`text-center text-[10px] mt-1 text-white/30 transition-opacity ${inputValue.length >= MAX_CHARS ? 'text-red-400' : ''}`}
        style={{ opacity: inputValue.length > 0 ? 1 : 0 }}
      >
        {inputValue.length}/{MAX_CHARS}
      </div>
    </div>
  );
}

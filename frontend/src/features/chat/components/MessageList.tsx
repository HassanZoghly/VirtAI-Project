import React from 'react';
import { PiLightbulbFilament, PiClockFill } from 'react-icons/pi';
import { Bot, User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import MessageBubble from './MessageBubble';
import { IMessage } from '../../session/types';

interface MessageListProps {
  messages: IMessage[];
  currentMessage: string | null;
  interimTranscript?: string;
  error?: string | null;
  avatarName: string;
  chatScrollRef: React.RefObject<HTMLDivElement>;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  pipelineState?: string;
  onSendText?: (text: string) => void;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
}

const MessageList = React.memo(function MessageList({
  messages,
  currentMessage,
  interimTranscript,
  avatarName,
  chatScrollRef,
  messagesEndRef,
  onScroll,
  pipelineState,
}: MessageListProps) {
  return (
    <div
      className="chat-messages"
      ref={chatScrollRef}
      onScroll={onScroll}
      role="log"
      aria-live="polite"
      aria-label="Chat messages"
    >
      {messages.length === 0 ? (
        <div className="welcome-state">
          <PiLightbulbFilament className="welcome-icon" />
          <h2 className="welcome-title">Start a conversation</h2>
          <p className="welcome-subtitle">Ask {avatarName} anything to begin your lesson.</p>
        </div>
      ) : (
        <div className="chat-stream">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}
          
          {/* Typing indicator when AI is thinking but not yet streaming */}
          {pipelineState === 'thinking' && !currentMessage && (
            <div
              className="chat-message-wrapper ai-message-wrapper message-enter"
              role="status"
              aria-label="AI is typing"
            >
              <div className="chat-message ai-message typing-state">
                <div className="message-avatar ai-avatar">
                  <Bot size={22} aria-hidden="true" />
                </div>
                <div className="message-bubble typing-indicator">
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                </div>
              </div>
            </div>
          )}

          {/* Show interim ASR transcript as grayed/italic user bubble */}
          {interimTranscript && (
            <div
              className="chat-message-wrapper user-message-wrapper"
              role="status"
              aria-live="polite"
            >
              <div className="chat-message user-message interim-transcript">
                <div className="message-bubble">{interimTranscript}</div>
                <div className="message-avatar user-avatar">
                  <User size={22} aria-hidden="true" />
                </div>
              </div>
            </div>
          )}

          {/* Show streaming message if present */}
          {currentMessage && (
            <div className="chat-message-wrapper ai-message-wrapper">
              <div className="chat-message ai-message items-start">
                <div className="message-avatar ai-avatar mt-1">
                  <Bot size={22} aria-hidden="true" />
                </div>
                <div className="message-bubble flex flex-col gap-2 max-w-none w-full">
                  <div className="markdown-body">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {currentMessage}
                    </ReactMarkdown>
                    <span className="streaming-cursor">▊</span>
                  </div>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}
    </div>
  );
});

export default MessageList;

import {
  PiLightbulbFilament,
} from 'react-icons/pi';
import { Bot, User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import MessageBubble from './MessageBubble';

/**
 * Scrollable message list with welcome state, streaming indicator, and error display.
 * @param {object} props
 * @param {{ id: string, role: string, content: string }[]} props.messages - Chat history
 * @param {string|null} props.currentMessage - In-progress streaming text
 * @param {string} [props.interimTranscript] - Interim ASR transcript (grayed/italic)
 * @param {string|null} props.error - Error message to display
 * @param {string} props.avatarName - Tutor display name for welcome text
 * @param {React.RefObject<HTMLDivElement>} props.chatScrollRef - Scroll container ref
 * @param {React.RefObject<HTMLDivElement>} props.messagesEndRef - Scroll-to-bottom anchor ref
 * @param {string} [props.pipelineState] - Pipeline state (e.g. 'thinking', 'speaking')
 * @param {(text: string) => void} [props.onSendText] - Send a message directly
 * @param {(e: React.UIEvent) => void} props.onScroll - Scroll event handler
 */
export default function MessageList({
  messages,
  currentMessage,
  interimTranscript,
  error,
  avatarName,
  chatScrollRef,
  messagesEndRef,
  onScroll,
  pipelineState,
}) {
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
                  <div className="markdown-body prose prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-headings:mb-2 prose-headings:mt-4 prose-hr:my-4">
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
}

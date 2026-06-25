import React, { ReactNode } from 'react';
import { Bot, User } from 'lucide-react';

export interface ChatMessageRowProps {
  role: 'user' | 'assistant';
  children: ReactNode;
  avatarName?: string;
  isTyping?: boolean;
  isInterim?: boolean;
  timeString?: string;
  ariaLabel?: string;
}

export const ChatMessageRow: React.FC<ChatMessageRowProps> = ({
  role,
  children,
  avatarName,
  isTyping,
  isInterim,
  timeString,
  ariaLabel
}) => {
  const isUser = role === 'user';
  
  return (
    <div
      className={`chat-message-wrapper ${isUser ? 'user-message-wrapper' : 'ai-message-wrapper'} ${isInterim ? '' : 'message-enter'}`}
      role={isInterim || isTyping ? 'status' : 'article'}
      aria-label={ariaLabel}
      aria-live={isInterim ? 'polite' : undefined}
    >
      <div 
        className={`chat-message ${isUser ? 'user-message' : 'ai-message'} ${isTyping ? 'typing-state' : 'items-start'} ${isInterim ? 'interim-transcript' : ''}`}
      >
        {!isUser && (
          <div className={`message-avatar ai-avatar ${isTyping ? '' : 'mt-1'}`}>
            <Bot size={22} aria-hidden="true" />
          </div>
        )}
        
        <div className={`message-bubble-container flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-none w-full`}>
          {!isUser && avatarName && !isTyping && (
            <div className="flex justify-start items-center w-full mt-1 mb-0.5 px-1 gap-1">
              <span className="font-extrabold text-[#D4B47A] text-[15px] tracking-wide">{avatarName}</span>
            </div>
          )}
          
          <div className={`message-bubble ${isUser ? (isInterim ? '' : 'user-bubble-content relative') : (isTyping ? 'typing-indicator' : 'flex flex-col gap-2 w-full')}`}>
            {children}
            
            {isUser && !isInterim && timeString && (
              <>
                <span className="inline-block w-[45px]"></span>
                <span className="absolute bottom-1 right-2 text-[10px] text-black/60 leading-none font-medium">
                  {timeString}
                </span>
              </>
            )}
          </div>
        </div>

        {isUser && (
          <div className="message-avatar user-avatar">
            <User size={22} aria-hidden="true" />
          </div>
        )}
      </div>
    </div>
  );
};

export const TypingDots: React.FC = () => (
  <>
    <span className="typing-dot" />
    <span className="typing-dot" />
    <span className="typing-dot" />
  </>
);

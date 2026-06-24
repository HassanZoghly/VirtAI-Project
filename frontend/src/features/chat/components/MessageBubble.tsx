import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bot, User } from 'lucide-react';
import CopyButton from '../../../shared/components/CopyButton';
import { VisualizeButton } from './VisualizeButton';
import { IMessage } from '../../session/types';

interface MessageBubbleProps {
  msg: IMessage;
  isLast?: boolean;
  avatarName: string;
  onScrollToBottom?: () => void;
}

const MessageBubble: React.FC<MessageBubbleProps> = memo(function MessageBubble({ msg, isLast, avatarName, onScrollToBottom }) {
  const isUser = msg.role === 'user';

  const timeString = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' }).format(
    new Date(msg.createdAt || Date.now())
  );

  return (
    <div
      className={`chat-message-wrapper ${isUser ? 'user-message-wrapper' : 'ai-message-wrapper'} message-enter`}
      role="article"
      aria-label={`${isUser ? 'You' : avatarName} at ${timeString}`}
    >
      <div className={`chat-message ${isUser ? 'user-message' : 'ai-message'} items-start`}>
        {!isUser && (
          <div className="message-avatar ai-avatar mt-1">
            <Bot size={22} aria-hidden="true" />
          </div>
        )}
        <div className={`message-bubble-container flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-none w-full`}>
          {!isUser && (
            <div className="flex justify-start items-center w-full mt-1 mb-0.5 px-1 gap-1">
              <span className="font-bold text-[#D4B47A] text-[15px] tracking-wide">{avatarName}</span>
            </div>
          )}
          <div className={`message-bubble ${isUser ? 'user-bubble-content relative' : 'flex flex-col gap-2 w-full'}`}>
            {isUser ? (
              <>
                {msg.content}
                <span className="inline-block w-[45px]"></span>
                <span className="absolute bottom-1 right-2 text-[10px] text-black/60 leading-none font-medium">
                  {timeString}
                </span>
              </>
            ) : (
              <>
              <div className="markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {msg.content}
                </ReactMarkdown>
              </div>
              <div className="flex justify-start gap-2 mt-2 items-center">
                <CopyButton content={msg.content} />
                {isLast && msg.id && (
                  <VisualizeButton messageId={msg.id} locale="en" onExpand={onScrollToBottom} />
                )}
              </div>
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
});

export default MessageBubble;

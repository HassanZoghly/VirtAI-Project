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
}

const MessageBubble: React.FC<MessageBubbleProps> = memo(function MessageBubble({ msg, isLast }) {
  const isUser = msg.role === 'user';

  return (
    <div
      className={`chat-message-wrapper ${isUser ? 'user-message-wrapper' : 'ai-message-wrapper'} message-enter`}
    >
      <div className={`chat-message ${isUser ? 'user-message' : 'ai-message'} items-start`}>
        {!isUser && (
          <div className="message-avatar ai-avatar mt-1">
            <Bot size={22} aria-hidden="true" />
          </div>
        )}
        <div className={`message-bubble ${isUser ? '' : 'flex flex-col gap-2 max-w-none w-full'}`}>
          {isUser ? (
            msg.content
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
                  <VisualizeButton messageId={msg.id} locale="en" />
                )}
              </div>
            </>
          )}
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

import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CopyButton from '../../../shared/components/CopyButton';
import { VisualizeButton } from './VisualizeButton';
import { IMessage } from '../../session/types';
import { formatTimeOnly } from '../../../shared/utils/date';
import { ChatBubble } from '../../../shared/components/ChatPrimitives';

interface MessageBubbleProps {
  msg: IMessage;
  isLast?: boolean;
  avatarName: string;
  onScrollToBottom?: () => void;
}

const MessageBubble: React.FC<MessageBubbleProps> = memo(function MessageBubble({ msg, isLast, avatarName, onScrollToBottom }) {
  const isUser = msg.role === 'user';
  const timeString = formatTimeOnly(msg.timestamp || Date.now());

  return (
    <ChatBubble
      role={isUser ? 'user' : 'assistant'}
      avatarName={avatarName}
      timeString={timeString}
      ariaLabel={`${isUser ? 'You' : avatarName} at ${timeString}`}
    >
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
              <VisualizeButton messageId={msg.id} locale="en" onExpand={onScrollToBottom} />
            )}
          </div>
        </>
      )}
    </ChatBubble>
  );
});

export default MessageBubble;

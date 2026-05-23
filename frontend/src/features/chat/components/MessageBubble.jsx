import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bot, User } from 'lucide-react';
import CopyButton from '../../../shared/components/CopyButton';

/**
 * Renders a single chat message with role-based styling and copy support.
 * @param {{ msg: { id: string, role: 'user'|'assistant', content: string } }} props
 */
const MessageBubble = memo(function MessageBubble({ msg }) {
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
              <div className="flex justify-start mt-2">
                <CopyButton content={msg.content} />
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

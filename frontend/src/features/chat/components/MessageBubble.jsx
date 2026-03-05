import { memo } from 'react';
import { PiRobotFill, PiUserCircleFill } from 'react-icons/pi';
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
      <div className={`chat-message ${isUser ? 'user-message' : 'ai-message'}`}>
        {!isUser && (
          <div className="message-avatar">
            <PiRobotFill aria-hidden="true" />
          </div>
        )}
        <div className="message-bubble">
          {msg.content}
          {!isUser && <CopyButton content={msg.content} />}
        </div>
        {isUser && (
          <div className="message-avatar">
            <PiUserCircleFill aria-hidden="true" />
          </div>
        )}
      </div>
    </div>
  );
});

export default MessageBubble;

import React from 'react';
import { PiWifiSlashFill } from 'react-icons/pi';
import { ConnectionState } from '@/core/realtime/useWSClient';
import { QuizButton } from '@/features/quiz/components/QuizButton';
import { DiagramButton } from '@/features/diagrams/components/DiagramButton';
import { ExplainButton } from '@/features/explain/components/ExplainButton';

interface AvatarTopBarProps {
  avatarName: string;
  connectionState: ConnectionState | string;
  currentSessionId: string | null;
  reconnectError: string | null;
  reconnect: () => void;
  hasDocuments: boolean;
  hasMessages: boolean;
  onGenerateDiagram: () => void;
  onStartExplain: () => void;
}

export function AvatarTopBar({
  avatarName,
  connectionState,
  currentSessionId,
  reconnectError,
  reconnect,
  hasDocuments,
  hasMessages,
  onGenerateDiagram,
  onStartExplain
}: AvatarTopBarProps) {
  const statusBadgeClass =
    !currentSessionId ? 'idle' :
    {
      [ConnectionState.OFFLINE]: 'offline',
      [ConnectionState.RECONNECTING]: 'reconnecting',
      [ConnectionState.INITIALIZING]: 'initializing',
      [ConnectionState.ONLINE]: 'online',
    }[connectionState as ConnectionState] || 'offline';

  const statusLabel =
    !currentSessionId ? `Ready  ·  ${avatarName}` :
    reconnectError ? `Error  ·  ${avatarName}` :
    {
      [ConnectionState.OFFLINE]: `Offline  ·  ${avatarName}`,
      [ConnectionState.RECONNECTING]: `Reconnecting…  ·  ${avatarName}`,
      [ConnectionState.INITIALIZING]: `Starting up…  ·  ${avatarName}`,
      [ConnectionState.ONLINE]: `${avatarName} is Online`,
    }[connectionState as ConnectionState] ||
    `Offline  ·  ${avatarName}`;

  return (
    <div className="classroom-top-controls">
      <div
        className={`avatar-status-badge ${statusBadgeClass}`}
        role="status"
        aria-live="polite"
      >
        {connectionState === ConnectionState.OFFLINE && currentSessionId !== null ? (
          <PiWifiSlashFill className="status-icon-offline" />
        ) : (
          <span
            className={`status-dot${connectionState === ConnectionState.RECONNECTING
              ? ' status-dot-reconnecting'
              : connectionState === ConnectionState.INITIALIZING
                ? ' status-dot-initializing'
                : currentSessionId === null
                  ? ' status-dot-idle'
                  : ''
              }`}
          />
        )}
        <span key={statusLabel} className="status-text">
          {statusLabel}
        </span>
        {reconnectError ? (
          <button type="button" onClick={reconnect} className="status-reconnect-btn">
            Reconnect
          </button>
        ) : null}
      </div>

      <div className="classroom-top-actions">
        <ExplainButton onClick={onStartExplain} isVisible={hasDocuments && !hasMessages} />
        <DiagramButton onClick={onGenerateDiagram} disabled={!hasDocuments} />
        <QuizButton disabled={!hasDocuments} />
      </div>
    </div>
  );
}

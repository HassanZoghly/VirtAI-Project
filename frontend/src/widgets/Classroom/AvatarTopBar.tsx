import React from 'react';
import { PiGearFill, PiWifiSlashFill } from 'react-icons/pi';
import { ConnectionState } from '@/core/realtime/useWSClient';
import { QuizButton } from '@/features/quiz/components/QuizButton';
import { DiagramButton } from '@/features/diagrams/components/DiagramButton';
import { ExplainButton } from '@/features/explain/components/ExplainButton';

interface AvatarTopBarProps {
  avatarName: string;
  connectionState: ConnectionState | string;
  currentSessionId: string | null;
  reconnectError: string | null;
  openSettings: () => void;
  reconnect: () => void;
  hasDocuments: boolean;
  hasMessages: boolean;
  onTakeQuiz: () => void;
  onGenerateDiagram: () => void;
  onStartExplain: () => void;
}

export function AvatarTopBar({
  avatarName,
  connectionState,
  currentSessionId,
  reconnectError,
  openSettings,
  reconnect,
  hasDocuments,
  hasMessages,
  onTakeQuiz,
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
    !currentSessionId ? `${avatarName} — Ready` :
    reconnectError ||
    {
      [ConnectionState.OFFLINE]: `${avatarName} — Offline`,
      [ConnectionState.RECONNECTING]: 'Reconnecting…',
      [ConnectionState.INITIALIZING]: 'Starting up…',
      [ConnectionState.ONLINE]: `${avatarName} Online`,
    }[connectionState as ConnectionState] ||
    `${avatarName} — Offline`;

  return (
    <div className="classroom-top-controls">
      <button
        className="avatar-settings-btn"
        onClick={openSettings}
        title="Settings"
        aria-label="Open settings"
      >
        <PiGearFill />
      </button>

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

      <div className="classroom-top-actions" style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
        <ExplainButton onClick={onStartExplain} isVisible={hasDocuments && !hasMessages} />
        <DiagramButton onClick={onGenerateDiagram} disabled={!hasDocuments} />
        <QuizButton onClick={onTakeQuiz} disabled={!hasDocuments} />
      </div>
    </div>
  );
}

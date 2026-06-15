import SlideDrawer from '../../../shared/components/SlideDrawer';
import SessionList from './SessionList';

/**
 * Side drawer for settings, session list, current session info, and tutor status.
 * @param {object} props
 * @param {boolean} props.isOpen - Whether the drawer is visible
 * @param {() => void} props.onClose - Close callback
 * @param {{ id: string, title: string }[]} props.sessions - All chat sessions
 * @param {string} props.currentSessionId - Active session ID
 * @param {(id: string) => void} props.onSessionSelect - Session switch callback
 * @param {() => void} props.onNewSession - New session callback
 * @param {(id: string) => void} props.onDeleteSession - Delete session callback
 * @param {(id: string, title: string) => void} props.onRenameSession - Rename session callback
 */
export default function SettingsDrawer({
  isOpen,
  onClose,
  sessions,
  currentSessionId,
  onSessionSelect,
  onNewSession,
  onDeleteSession,
  onRenameSession,
  onClearAllSessions,
}) {
  return (
    <SlideDrawer
      isOpen={isOpen}
      onClose={onClose}
      contentClassName="sidebar-minimal"
      enableDrag={true}
    >
      <div
        className="drawer-body"
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          padding: '1rem 0',
          minHeight: 0,
        }}
      >
        <SessionList
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSessionSelect={onSessionSelect}
          onNewSession={onNewSession}
          onDeleteSession={onDeleteSession}
          onRenameSession={onRenameSession}
          onClearAllSessions={onClearAllSessions}
          onCloseDrawer={onClose}
        />
      </div>
    </SlideDrawer>
  );
}

import SlideDrawer from '../../../shared/components/SlideDrawer';
import { DocumentsPanel } from './DocumentsPanel';

interface DocumentsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId?: string | null;
}

export function DocumentsDrawer({ isOpen, onClose, sessionId }: DocumentsDrawerProps) {
  return (
    <SlideDrawer
      title="Documents"
      description="Manage your documents"
      isOpen={isOpen}
      onClose={onClose}
      contentClassName="documents-drawer-content"
      zIndex={1000}
    >
      <DocumentsPanel sessionId={sessionId} onClose={onClose} />
    </SlideDrawer>
  );
}

import SlideDrawer from '../../../shared/components/SlideDrawer';
import { DocumentsPanel } from './DocumentsPanel';

export function DocumentsDrawer({ isOpen, onClose, sessionId }) {
  return (
    <SlideDrawer
      isOpen={isOpen}
      onClose={onClose}
      contentClassName="documents-drawer-content"
      zIndex={1000}
    >
      <DocumentsPanel sessionId={sessionId} onClose={onClose} />
    </SlideDrawer>
  );
}

import SlideDrawer from '../../../shared/components/SlideDrawer';
import { DocumentsPanel } from './DocumentsPanel';

interface DocumentsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId?: string | null;
  width?: number;
  onWidthChange?: (width: number) => void;
  resizable?: boolean;
}

export function DocumentsDrawer({ isOpen, onClose, sessionId, width, onWidthChange, resizable }: DocumentsDrawerProps) {
  return (
    <SlideDrawer
      title="Documents"
      description="Manage your documents"
      isOpen={isOpen}
      onClose={onClose}
      contentClassName="documents-drawer-content"
      zIndex={1000}
      width={width}
      onWidthChange={onWidthChange}
      resizable={resizable}
    >
      <DocumentsPanel sessionId={sessionId} onClose={onClose} />
    </SlideDrawer>
  );
}

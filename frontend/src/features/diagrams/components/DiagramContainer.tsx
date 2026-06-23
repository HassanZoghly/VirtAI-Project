import React, { useState } from 'react';
import SlideDrawer from '@/shared/components/SlideDrawer';
import { useDiagramSession } from '../hooks/useDiagramSession';
import { DocumentPicker } from './DocumentPicker';
import { DiagramViewer } from './DiagramViewer';
import './DiagramContainer.css';

interface DiagramContainerProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string | null;
}

export function DiagramContainer({ isOpen, onClose, sessionId }: DiagramContainerProps) {
  const { diagramState, diagramData, startDiagramGeneration, resetDiagram } = useDiagramSession();
  const [showViewer, setShowViewer] = useState(false);

  const handleSelectDocument = (documentId: string) => {
    setShowViewer(true);
    startDiagramGeneration(documentId, 'en');
  };

  const handleClose = () => {
    onClose();
    // small delay to allow drawer closing animation to finish before resetting
    setTimeout(() => {
      resetDiagram();
      setShowViewer(false);
    }, 300);
  };

  const handleCloseViewerOnly = () => {
    resetDiagram();
    setShowViewer(false);
  };

  return (
    <SlideDrawer
      title="Knowledge Diagram"
      description="Visualize document structure"
      isOpen={isOpen}
      onClose={handleClose}
      contentClassName="diagram-drawer-content"
      zIndex={1000}
    >
      <div className="diagram-container-body">
        {!showViewer ? (
          <DocumentPicker 
            sessionId={sessionId} 
            onSelect={handleSelectDocument} 
            onCancel={handleClose} 
          />
        ) : (
          <DiagramViewer 
            diagramData={diagramData}
            isLoading={diagramState === 'generating'}
            onClose={handleCloseViewerOnly}
          />
        )}
      </div>
    </SlideDrawer>
  );
}

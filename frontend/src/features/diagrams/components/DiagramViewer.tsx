import React, { useEffect, useState, useCallback } from 'react';
import { useMermaidRender } from '../hooks/useMermaidRender';
import { DiagramData } from '../api/diagramApi';
import { FiDownload, FiMaximize, FiMinimize, FiX } from 'react-icons/fi';
import './DiagramViewer.css';

interface DiagramViewerProps {
  diagramData: DiagramData | null;
  isLoading: boolean;
  onClose: () => void;
}

export function DiagramViewer({ diagramData, isLoading, onClose }: DiagramViewerProps) {
  const { containerRef, svgContent, error, isLoading: isRenderLoading } = useMermaidRender(diagramData?.mermaid_code);
  const [isExpanded, setIsExpanded] = useState(false);

  // Handle ESC to close expanded mode or the viewer itself
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isExpanded) {
          setIsExpanded(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isExpanded, onClose]);

  const handleDownloadSVG = useCallback(() => {
    if (!svgContent) return;
    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `diagram-${diagramData?.id}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [svgContent, diagramData?.id]);

  const handleDownloadPNG = useCallback(() => {
    if (!svgContent) return;
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    // We need to convert SVG string to a data URL that can be drawn on canvas
    const svgBlob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    
    img.onload = () => {
      // Set canvas dimensions to match the image
      canvas.width = img.width;
      canvas.height = img.height;
      
      // Draw white background (SVGs are often transparent)
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        
        // Export to PNG
        const pngUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = pngUrl;
        link.download = `diagram-${diagramData?.id}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
      URL.revokeObjectURL(url);
    };
    
    img.src = url;
  }, [svgContent, diagramData?.id]);

  if (isLoading || (isRenderLoading && !error)) {
    return (
      <div className="diagram-viewer-loading">
        <div className="spinner"></div>
        <p>Generating Diagram...</p>
      </div>
    );
  }

  const toggleExpand = () => setIsExpanded(!isExpanded);

  return (
    <div className={`diagram-viewer-container ${isExpanded ? 'expanded' : ''}`}>
      <div className="diagram-viewer-header">
        <h3 className="diagram-title">Knowledge Diagram</h3>
        <div className="diagram-actions">
          {svgContent && (
            <div className="dropdown">
              <button className="icon-btn" title="Download">
                <FiDownload />
              </button>
              <div className="dropdown-content">
                <button onClick={handleDownloadSVG}>Download SVG</button>
                <button onClick={handleDownloadPNG}>Download PNG</button>
              </div>
            </div>
          )}
          <button className="icon-btn" onClick={toggleExpand} title={isExpanded ? "Collapse" : "Expand"}>
            {isExpanded ? <FiMinimize /> : <FiMaximize />}
          </button>
          <button className="icon-btn close-btn" onClick={onClose} title="Close">
            <FiX />
          </button>
        </div>
      </div>

      <div className="diagram-viewer-content">
        {error ? (
          <div className="diagram-error">
            <p className="error-title">Failed to render diagram</p>
            <p className="error-message">{error}</p>
          </div>
        ) : (
          <div 
            ref={containerRef} 
            className="mermaid-container"
          />
        )}
      </div>

      {diagramData?.citations && diagramData.citations.length > 0 && !isExpanded && (
        <div className="diagram-citations">
          <h4>Sources used:</h4>
          <ul>
            {diagramData.citations.map((cite, idx) => (
              <li key={idx}>"{cite}"</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

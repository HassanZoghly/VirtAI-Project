import React, { useCallback } from 'react';
import { useMermaidRender } from '../hooks/useMermaidRender';
import { DiagramData } from '../api/diagramApi';
import { FiDownload, FiX } from 'react-icons/fi';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';

interface DiagramViewerProps {
  diagramData: DiagramData | null;
  isLoading: boolean;
  onClose: () => void;
}

export function DiagramViewer({ diagramData, isLoading, onClose }: DiagramViewerProps) {
  const { containerRef, svgContent, error, isLoading: isRenderLoading } = useMermaidRender(diagramData?.mermaid_code);

  const handleDownloadPNG = useCallback(() => {
    if (!svgContent) return;
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    const svgBlob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      if (ctx) {
        // Draw white background for transparent SVGs
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        
        const pngUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = pngUrl;
        link.download = `diagram-${diagramData?.id || 'export'}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
      URL.revokeObjectURL(url);
    };
    
    img.src = url;
  }, [svgContent, diagramData?.id]);

  return (
    <div className="w-full h-full relative flex flex-col bg-dark overflow-hidden">
      {/* Floating Overlay Controls */}
      <div className="absolute top-4 right-4 flex items-center gap-3 z-50">
        <button
          onClick={handleDownloadPNG}
          disabled={!svgContent}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-dark/60 backdrop-blur-md border border-gold/15 text-sm font-medium text-gold-soft hover:bg-gold/5 hover:border-gold/30 hover:scale-[1.02] transition-[background-color,border-color,transform] duration-300 shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <FiDownload size={16} />
          <span>Download Diagram</span>
        </button>
        <button
          onClick={onClose}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-dark/60 backdrop-blur-md border border-gold/15 text-sm font-medium text-gold-soft hover:bg-gold/5 hover:border-gold/30 hover:scale-[1.02] transition-[background-color,border-color,transform] duration-300 shadow-xl"
        >
          <FiX size={16} />
          <span>Close Diagram</span>
        </button>
      </div>

      <div className="flex-1 w-full h-full cursor-grab active:cursor-grabbing overflow-hidden relative">
        {(isLoading || (isRenderLoading && !error)) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-dark z-10 animate-fade-in">
            <div className="w-8 h-8 border-2 border-gold/20 border-t-gold rounded-full animate-spin mb-4" />
            <p className="text-gold-soft/80 text-sm font-medium">Synthesizing conceptual relationship diagram...</p>
          </div>
        )}
        
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-dark z-10 text-center p-6">
            <p className="text-crimson-glow font-medium mb-2">Diagram Rendering Failed</p>
            <p className="text-offwhite/70 text-sm max-w-md">
              We were unable to render the concept diagram due to a syntax parsing conflict. Please review the chat explanation or attempt to regenerate the layout.
            </p>
            {error && <p className="text-offwhite/40 text-xs mt-2 font-mono">({error})</p>}
          </div>
        )}

        {!error && !isLoading && (
          <TransformWrapper
            initialScale={1}
            minScale={0.2}
            maxScale={4}
            centerOnInit={true}
          >
            <TransformComponent wrapperClass="!w-full !h-full" contentClass="!w-full !h-full flex items-center justify-center">
              <div 
                ref={containerRef} 
                className="w-full h-full flex items-center justify-center p-8 diagram-content-wrapper"
              />
            </TransformComponent>
          </TransformWrapper>
        )}
      </div>

      {diagramData?.citations && diagramData.citations.length > 0 && (
        <div className="absolute bottom-4 left-4 right-4 bg-dark-secondary/80 backdrop-blur-md border border-gold/15 rounded-2xl p-4 z-40 max-h-32 overflow-y-auto shadow-2xl">
          <h4 className="text-xs font-semibold text-gold/70 mb-2 uppercase tracking-wider">Academic Source Citations</h4>
          <ul className="flex flex-col gap-1">
            {diagramData.citations.map((cite, idx) => (
              <li key={idx} className="text-sm text-offwhite/70">"{cite}"</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

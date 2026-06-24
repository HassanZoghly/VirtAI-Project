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
    <div className="w-full h-full relative flex flex-col bg-[#1A1A1A] overflow-hidden">
      {/* Floating Overlay Controls */}
      <div className="absolute top-4 right-4 flex items-center gap-3 z-50">
        <button
          onClick={handleDownloadPNG}
          disabled={!svgContent}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-black/40 backdrop-blur-md border border-white/10 text-sm font-medium text-white/90 hover:bg-white/10 hover:border-white/20 hover:scale-[1.02] transition-[background-color,border-color,transform] duration-300 shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <FiDownload size={16} />
          <span>Download</span>
        </button>
        <button
          onClick={onClose}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-black/40 backdrop-blur-md border border-white/10 text-sm font-medium text-white/90 hover:bg-white/10 hover:border-white/20 hover:scale-[1.02] transition-[background-color,border-color,transform] duration-300 shadow-xl"
        >
          <FiX size={16} />
          <span>Close</span>
        </button>
      </div>

      <div className="flex-1 w-full h-full cursor-grab active:cursor-grabbing overflow-hidden relative">
        {(isLoading || (isRenderLoading && !error)) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1A1A1A] z-10">
            <div className="w-8 h-8 border-2 border-white/20 border-t-white/80 rounded-full animate-spin mb-4" />
            <p className="text-white/60 text-sm font-medium">Generating Knowledge Diagram...</p>
          </div>
        )}
        
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1A1A1A] z-10 text-center p-6">
            <p className="text-red-400 font-medium mb-2">Failed to render diagram</p>
            <p className="text-white/50 text-sm">{error}</p>
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
        <div className="absolute bottom-4 left-4 right-4 bg-black/40 backdrop-blur-md border border-white/10 rounded-2xl p-4 z-40 max-h-32 overflow-y-auto">
          <h4 className="text-xs font-semibold text-white/70 mb-2 uppercase tracking-wider">Sources</h4>
          <ul className="flex flex-col gap-1">
            {diagramData.citations.map((cite, idx) => (
              <li key={idx} className="text-sm text-white/60">"{cite}"</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

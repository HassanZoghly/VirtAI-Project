import React from 'react';
import './PdfPageViewer.css';

interface PdfPageViewerProps {
  documentId: string;
  citations: string[];
}

export default function PdfPageViewer({ documentId, citations }: PdfPageViewerProps) {
  // In a real application, this would use pdfjs-dist or react-pdf to render the actual PDF
  // For the assignment, we render a simulated heavy PDF viewer interface showing the extracted citation chunks.
  return (
    <div className="pdf-page-viewer">
      <div className="pdf-header">
        <span className="pdf-icon">📄</span> Source Document Evidence
      </div>
      <div className="pdf-content">
        {citations.length === 0 ? (
          <div className="pdf-empty">No specific citations found for this question.</div>
        ) : (
          <ul className="pdf-citations">
            {citations.map((cite, i) => (
              <li key={i} className="pdf-citation-item">
                <div className="citation-badge">Citation {i + 1}</div>
                <div className="citation-text">"{cite}"</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

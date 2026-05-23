import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FiFileText, FiClock, FiCheckCircle, FiXCircle } from 'react-icons/fi';
import './SessionHoverPreview.css';

export default function SessionHoverPreview({ session, triggerElement, isHovered }) {
  const [show, setShow] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (isHovered) {
      timerRef.current = setTimeout(() => {
        setShow(true);
      }, 2000); // 2s delay
    } else {
      if (timerRef.current) clearTimeout(timerRef.current);
      setShow(false);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isHovered]);

  if (!show || !triggerElement) return null;
  if (!session.documents || session.documents.length === 0) return null;

  const rect = triggerElement.getBoundingClientRect();
  const top = rect.top + window.scrollY;
  const left = rect.right + window.scrollX + 10;

  const maxFiles = 3;
  const displayedFiles = session.documents.slice(0, maxFiles);
  const remainingFiles = session.documents.length - maxFiles;

  return createPortal(
    <div 
      className="session-hover-preview"
      style={{
        position: 'absolute',
        top: `${top}px`,
        left: `${left}px`,
        zIndex: 9999
      }}
    >
      <div className="preview-header">
        Attached Documents
      </div>
      <div className="preview-files">
        {displayedFiles.map(doc => (
          <div key={doc.id} className="preview-file-item">
            <FiFileText className="preview-file-icon" />
            <span className="preview-file-name" title={doc.filename}>{doc.filename}</span>
            {doc.status === 'QUEUED' && <FiClock className="preview-status-icon pending" />}
            {doc.status === 'READY' && <FiCheckCircle className="preview-status-icon success" />}
            {doc.status === 'FAILED' && <FiXCircle className="preview-status-icon error" />}
          </div>
        ))}
        {remainingFiles > 0 && (
          <div className="preview-file-more">
            +{remainingFiles} more {remainingFiles === 1 ? 'file' : 'files'}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

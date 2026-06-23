import React, { useState } from 'react';
import { useDocumentList } from '@/features/documents/useDocumentList';
import './DocumentPicker.css';

interface DocumentPickerProps {
  sessionId: string | null;
  onSelect: (documentId: string) => void;
  onCancel: () => void;
}

export function DocumentPicker({ sessionId, onSelect, onCancel }: DocumentPickerProps) {
  const { documents, isLoading } = useDocumentList(sessionId);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleConfirm = () => {
    if (selectedId) {
      onSelect(selectedId);
    }
  };

  if (isLoading && documents.length === 0) {
    return <div className="document-picker-loading">Loading documents...</div>;
  }

  return (
    <div className="document-picker-container">
      <h3 className="document-picker-title">Select Document for Diagram</h3>
      {documents.length === 0 ? (
        <p className="document-picker-empty">No documents found for this session.</p>
      ) : (
        <div className="document-list-radio">
          {documents.map(doc => (
            <label
              key={doc.id || doc.temp_id}
              className={`document-radio-item ${selectedId === doc.id ? 'selected' : ''} ${!doc.id ? 'disabled' : ''}`}
            >
              <input
                type="radio"
                name="document_selection"
                value={doc.id || ''}
                checked={selectedId === doc.id}
                onChange={() => doc.id && setSelectedId(doc.id)}
                disabled={!doc.id}
              />
              <span className="document-name">{doc.filename}</span>
              {!doc.id && <span className="document-status-hint">(Processing...)</span>}
            </label>
          ))}
        </div>
      )}

      <div className="document-picker-actions">
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button
          className="btn-primary"
          onClick={handleConfirm}
          disabled={!selectedId}
        >
          Generate
        </button>
      </div>
    </div>
  );
}

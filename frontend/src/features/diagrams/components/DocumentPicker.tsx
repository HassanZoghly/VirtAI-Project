import React, { useState } from 'react';
import { useDocumentList } from '@/features/documents/useDocumentList';
import { PiFilePdfDuotone } from 'react-icons/pi';
import { FiCheck } from 'react-icons/fi';

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
    return (
      <div className="bg-[#1A1A1A] rounded-2xl border border-white/5 p-8 flex flex-col items-center justify-center min-h-[300px]">
        <div className="w-8 h-8 border-2 border-white/20 border-t-white/80 rounded-full animate-spin mb-4" />
        <p className="text-white/60 text-sm font-medium">Loading documents...</p>
      </div>
    );
  }

  return (
    <div className="bg-[#1A1A1A] rounded-2xl border border-white/5 p-8 shadow-2xl flex flex-col relative">
      <h2 className="text-xl font-bold text-white/90 tracking-wide mb-6 text-center">
        Select Document for Diagram
      </h2>

      {documents.length === 0 ? (
        <div className="py-12 flex flex-col items-center justify-center text-center">
          <PiFilePdfDuotone className="w-12 h-12 text-white/20 mb-3" />
          <p className="text-white/60 text-sm font-medium">No documents found for this session.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
          {documents.map((doc) => {
            const isSelected = selectedId === doc.id;
            const isProcessing = !doc.id;

            return (
              <label
                key={doc.id || doc.temp_id}
                className={`flex items-center gap-4 p-4 rounded-2xl border cursor-pointer transition-all duration-300 group ${
                  isSelected
                    ? 'bg-white/10 border-white/30 shadow-[0_0_15px_rgba(255,255,255,0.05)]'
                    : isProcessing
                    ? 'bg-white/5 border-white/5 opacity-50 cursor-not-allowed'
                    : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10 hover:shadow-lg hover:-translate-y-0.5'
                }`}
              >
                <input
                  type="radio"
                  name="document_selection"
                  value={doc.id || ''}
                  checked={isSelected}
                  onChange={() => !isProcessing && doc.id && setSelectedId(doc.id)}
                  disabled={isProcessing}
                  className="sr-only"
                />
                
                <div className="flex-shrink-0">
                  <PiFilePdfDuotone className={`w-6 h-6 transition-colors ${isSelected ? 'text-white' : 'text-gray-400 group-hover:text-white'}`} />
                </div>
                
                <div className="flex-1 min-w-0 flex flex-col">
                  <span className={`text-sm font-medium truncate ${isSelected ? 'text-white' : 'text-white/80'}`}>
                    {doc.filename}
                  </span>
                  {isProcessing && (
                    <span className="text-xs text-white/40 mt-0.5">Processing...</span>
                  )}
                </div>

                <div className="flex-shrink-0 ml-2">
                  {isSelected ? (
                    <div className="w-5 h-5 rounded-full bg-white flex items-center justify-center shadow-[0_0_8px_rgba(255,255,255,0.5)]">
                      <FiCheck className="text-black w-3 h-3" strokeWidth={3} />
                    </div>
                  ) : (
                    <div className="w-5 h-5 rounded-full border border-white/20 group-hover:border-white/40 transition-colors" />
                  )}
                </div>
              </label>
            );
          })}
        </div>
      )}

      <div className="mt-8 flex items-center justify-between gap-4 pt-6 border-t border-white/5">
        <button
          onClick={onCancel}
          className="px-6 py-2.5 rounded-full text-sm font-medium text-white/60 hover:text-white hover:bg-white/5 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={!selectedId}
          className="px-8 py-2.5 rounded-full text-sm font-semibold text-black bg-white hover:bg-gray-100 disabled:bg-white/10 disabled:text-white/30 disabled:cursor-not-allowed transition-all duration-300 shadow-xl"
        >
          Generate Diagram
        </button>
      </div>
    </div>
  );
}

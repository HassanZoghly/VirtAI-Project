import { useRef, useState } from 'react';
import { FiUploadCloud, FiFileText, FiX, FiCheckCircle, FiAlertCircle } from 'react-icons/fi';
import { useDocumentUpload } from '../../documents/useDocumentUpload';
import { useDocumentList } from '../../documents/useDocumentList';

const MAX_FILE_SIZE_MB = 25;
const ACCEPTED_EXTENSIONS = new Set(['pdf', 'txt', 'md']);

function validateSelectedFile(file) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!extension || !ACCEPTED_EXTENSIONS.has(extension)) {
    return 'Choose a PDF, TXT, or MD file.';
  }
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    return `File must be ${MAX_FILE_SIZE_MB}MB or smaller.`;
  }
  return null;
}

export function UploadTab({ onUploaded, onSkip }) {
  const fileInputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [localError, setLocalError] = useState(null);
  const { upload, isUploading, isPolling, progress, stage, error, cancel, reset } =
    useDocumentUpload();
  const { refresh } = useDocumentList();

  const setFile = (file) => {
    if (file) {
      const validationError = validateSelectedFile(file);
      if (validationError) {
        setSelectedFile(null);
        setLocalError(validationError);
        reset();
        return;
      }
      setSelectedFile(file);
      setLocalError(null);
      reset();
    }
  };

  const handleFileSelect = (e) => {
    setFile(e.target.files[0]);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setFile(e.dataTransfer.files[0]);
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      return;
    }
    try {
      await upload(selectedFile);
      refresh();
      setTimeout(() => onUploaded(), 900);
    } catch (err) {
      // Error is handled by the hook.
    }
  };

  const handleCancel = () => {
    cancel();
    setSelectedFile(null);
    setLocalError(null);
  };

  const uploadError = localError || error;

  return (
    <div className="tab-pane upload-tab fade-in">
      <div className="upload-card">
        <div className="upload-header">
          <h2 className="setup-section-title">Add Knowledge Base</h2>
          <p className="setup-section-subtitle">
            Upload course notes or references your tutor can use during lessons.
          </p>
        </div>

        <div
          className={`upload-area ${selectedFile ? 'has-file' : ''} ${
            isUploading || isPolling ? 'disabled' : ''
          } ${uploadError ? 'has-error' : ''}`}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => !isUploading && !isPolling && fileInputRef.current?.click()}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
            className="sr-only"
          />

          {selectedFile ? (
            <div className="selected-file" onClick={(e) => e.stopPropagation()}>
              <FiFileText className="file-icon" />
              <div className="file-details">
                <span className="filename">{selectedFile.name}</span>
                <span className="filesize">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</span>
              </div>
              {!(isUploading || isPolling || stage === 'COMPLETE') && (
                <button
                  className="icon-btn remove-btn"
                  onClick={() => {
                    setSelectedFile(null);
                    setLocalError(null);
                  }}
                  aria-label="Remove selected file"
                >
                  <FiX />
                </button>
              )}
            </div>
          ) : (
            <div className="upload-prompt">
              <span className="upload-icon-wrap">
                <FiUploadCloud />
              </span>
              <p>Drag a file here, or click to browse</p>
              <span className="upload-formats">PDF, TXT, or MD up to 25MB</span>
            </div>
          )}
        </div>

        {(isUploading || isPolling || stage === 'COMPLETE' || uploadError) && (
          <div className="upload-progress-container">
            <div className="progress-header">
              <span className="progress-stage">
                {stage === 'COMPLETE'
                  ? 'Ready'
                  : uploadError
                    ? 'Upload failed'
                    : stage || 'Uploading'}
              </span>
              {!uploadError && stage !== 'COMPLETE' && (
                <span className="progress-pct">{progress}%</span>
              )}
            </div>

            {!uploadError && (
              <div className="progress-bar-bg">
                <div
                  className={`progress-bar-fill ${stage === 'COMPLETE' ? 'success' : ''}`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}

            {uploadError && (
              <div className="upload-error">
                <FiAlertCircle /> {uploadError}
              </div>
            )}

            {stage === 'COMPLETE' && !uploadError && (
              <div className="upload-success">
                <FiCheckCircle /> Document processed and ready.
              </div>
            )}
          </div>
        )}

        <div className="tab-actions">
          <button className="btn secondary" onClick={onSkip} disabled={isUploading || isPolling}>
            Skip for now
          </button>

          {isUploading || isPolling ? (
            <button className="btn warning" onClick={handleCancel}>
              Cancel Upload
            </button>
          ) : (
            <button
              className="btn primary"
              onClick={handleUpload}
              disabled={!selectedFile || stage === 'COMPLETE'}
            >
              Upload & Process
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

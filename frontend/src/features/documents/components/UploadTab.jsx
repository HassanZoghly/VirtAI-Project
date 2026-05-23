import { useRef, useState, useEffect, useCallback } from 'react';
import { FiUploadCloud, FiFileText, FiX, FiCheckCircle, FiAlertCircle, FiLoader } from 'react-icons/fi';
import { documentApi } from '../documentApi';
import { createPollingTransport } from '../transport/createPollingTransport';
import { motion, AnimatePresence } from 'motion/react';

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

/* ── Per-file mini progress bar shown inline in the file list ── */
function FileProgressBar({ progress, stage, error }) {
  const [displayProgress, setDisplayProgress] = useState(0);

  useEffect(() => {
    if (error) return;
    if (stage === 'COMPLETE') {
      setDisplayProgress(100);
      return;
    }
    if (progress > 0) {
      if (displayProgress > progress) {
        setDisplayProgress(progress);
      } else if (progress > displayProgress) {
        const step = (progress - displayProgress) * 0.18;
        const timer = requestAnimationFrame(() => {
          setDisplayProgress(prev => Math.min(prev + Math.max(step, 0.5), progress));
        });
        return () => cancelAnimationFrame(timer);
      }
    } else if (stage && displayProgress < 15) {
      const timer = requestAnimationFrame(() => {
        setDisplayProgress(prev => Math.min(prev + 0.18, 15));
      });
      return () => cancelAnimationFrame(timer);
    }
  }, [progress, displayProgress, stage, error]);

  const getStageText = () => {
    if (error) return 'Failed';
    if (stage === 'COMPLETE') return 'Ready';
    if (stage === 'PARSING') return 'Parsing...';
    if (stage === 'CHUNKING' || stage === 'PROCESSING') return 'Processing...';
    if (stage === 'EMBEDDING') return 'Embedding...';
    if (stage === 'INDEXING') return 'Indexing...';
    if (stage === 'QUEUED') return 'Queued...';
    if (stage === 'UPLOADING') return 'Uploading...';
    return 'Waiting...';
  };

  if (stage === 'COMPLETE' && !error) {
    return null; // Completed files just show the check icon, no bar needed
  }

  return (
    <div className="file-inline-progress">
      <div className="file-progress-header">
        <span className="file-progress-stage">{getStageText()}</span>
        {!error && <span className="file-progress-pct">{Math.round(displayProgress)}%</span>}
      </div>
      {!error && (
        <div className="file-progress-bar-bg">
          <div
            className={`file-progress-bar-fill ${stage === 'COMPLETE' ? 'success' : ''}`}
            style={{ width: `${displayProgress}%` }}
          />
        </div>
      )}
      {error && (
        <div className="file-progress-error">{error}</div>
      )}
    </div>
  );
}

/**
 * Uploads a single file and polls until completion.
 * Returns a promise that resolves on COMPLETE or rejects on error.
 */
async function uploadAndPoll(file, sessionId, onProgress) {
  // 1. Upload
  onProgress({ stage: 'UPLOADING', progress: 0 });
  const response = await documentApi.upload(file, sessionId);
  const docId = response.id;

  if (response.status === 'COMPLETE' || response.current_stage === 'COMPLETE') {
    onProgress({ stage: 'COMPLETE', progress: 100 });
    return response;
  }

  onProgress({ stage: response.current_stage || 'QUEUED', progress: 0, documentId: docId });

  // 2. Poll
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const cancelPoll = createPollingTransport({
      fetchStatusFn: () => documentApi.getStatus(docId),
      onProgress: (status) => {
        if (Date.now() - startTime > 180000) {
          cancelPoll?.();
          const err = new Error('Processing timeout');
          onProgress({ stage: 'FAILED', progress: 0, error: err.message });
          reject(err);
          return;
        }
        onProgress({
          stage: status.current_stage,
          progress: status.progress_pct || 0,
        });
      },
      onComplete: (status) => {
        onProgress({ stage: 'COMPLETE', progress: 100 });
        resolve(status);
      },
      onError: (error) => {
        onProgress({ stage: 'FAILED', progress: 0, error: error.message });
        reject(error);
      },
    });
  });
}

export function UploadTab({ onUploaded, onSkip, sessionId }) {
  const fileInputRef = useRef(null);
  const [selectedFiles, setSelectedFiles] = useState([]);      // File objects
  const [localErrors, setLocalErrors] = useState({});          // fileName -> validation error
  const [fileStates, setFileStates] = useState({});            // fileName -> { stage, progress, error }
  const [isProcessing, setIsProcessing] = useState(false);
  const cancelRef = useRef(false);

  const setFiles = (files) => {
    if (!files || files.length === 0) return;
    const newFiles = Array.from(files);
    const validFiles = [];
    const errors = { ...localErrors };

    newFiles.forEach(file => {
      if (selectedFiles.some(f => f.name === file.name) || validFiles.some(f => f.name === file.name)) {
        return;
      }
      const validationError = validateSelectedFile(file);
      if (validationError) {
        errors[file.name] = validationError;
      } else {
        validFiles.push(file);
      }
    });

    setSelectedFiles(prev => [...prev, ...validFiles]);
    setLocalErrors(errors);
  };

  const handleFileSelect = (e) => {
    setFiles(e.target.files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setFiles(e.dataTransfer.files);
  };

  const removeFile = (fileName) => {
    setSelectedFiles(prev => prev.filter(f => f.name !== fileName));
    const newErrors = { ...localErrors };
    delete newErrors[fileName];
    setLocalErrors(newErrors);
    setFileStates(prev => {
      const next = { ...prev };
      delete next[fileName];
      return next;
    });
  };

  const handleUpload = useCallback(async () => {
    if (selectedFiles.length === 0) return;

    // Filter to files not yet completed
    const filesToUpload = selectedFiles.filter(
      f => fileStates[f.name]?.stage !== 'COMPLETE'
    );
    if (filesToUpload.length === 0) {
      if (onUploaded) onUploaded();
      return;
    }

    setIsProcessing(true);
    cancelRef.current = false;

    for (const file of filesToUpload) {
      if (cancelRef.current) break;

      try {
        await uploadAndPoll(file, sessionId, ({ stage, progress, error }) => {
          setFileStates(prev => ({
            ...prev,
            [file.name]: { stage, progress, error: error || null },
          }));
        });
        
        // Properly unmount the progress bar by removing the file from the local upload queue
        removeFile(file.name);

        // Trigger Knowledge Base refresh after EACH successful file
        if (onUploaded) onUploaded();
      } catch (err) {
        // Error state is already set via onProgress callback
        // Stop the queue on error
        break;
      }
    }

    setIsProcessing(false);
  }, [selectedFiles, fileStates, sessionId, onUploaded]);

  const handleCancel = () => {
    cancelRef.current = true;
    setIsProcessing(false);
  };

  const hasFiles = selectedFiles.length > 0;
  const allCompleted = hasFiles && selectedFiles.every(f => fileStates[f.name]?.stage === 'COMPLETE');

  return (
    <div className="tab-pane upload-tab fade-in">
      <div className="upload-card modern-glass-card">
        <div className="upload-header">
          <h2 className="setup-section-title">Add Knowledge Base</h2>
          <p className="setup-section-subtitle">
            Upload course notes or references your tutor can use during lessons.
          </p>
        </div>

        <div
          className={`upload-area ${hasFiles ? 'has-file' : ''} ${isProcessing ? 'disabled' : ''}`}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => !isProcessing && fileInputRef.current?.click()}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
            className="sr-only"
            multiple
          />

          {!hasFiles ? (
            <div className="upload-prompt">
              <span className="upload-icon-wrap">
                <FiUploadCloud />
              </span>
              <p>Drag files here, or click to browse</p>
              <span className="upload-formats">PDF, TXT, or MD up to 25MB</span>
            </div>
          ) : (
            <div className="selected-files-list" onClick={(e) => e.stopPropagation()}>
              <AnimatePresence>
                {selectedFiles.map((file) => {
                  const state = fileStates[file.name];
                  const isCompleted = state?.stage === 'COMPLETE';
                  const isFailed = state?.stage === 'FAILED';
                  const isActive = state && !isCompleted && !isFailed && state.stage !== undefined;
                  const fileError = localErrors[file.name] || state?.error || null;

                  return (
                    <motion.div
                      key={file.name}
                      className={`file-list-item ${isActive ? 'processing' : ''} ${isCompleted ? 'completed' : ''} ${fileError ? 'error' : ''}`}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                    >
                      <FiFileText className="file-list-icon" />
                      <div className="file-list-details">
                        <span className="file-list-name">{file.name}</span>
                        <span className="file-list-size">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                        {localErrors[file.name] && (
                          <span className="file-list-error-text">{localErrors[file.name]}</span>
                        )}
                        {/* Per-file progress bar */}
                        {state && !isCompleted && (
                          <FileProgressBar
                            progress={state.progress || 0}
                            stage={state.stage}
                            error={state.error}
                          />
                        )}
                      </div>

                      {!isProcessing && !isCompleted && (
                        <button
                          className="icon-btn remove-btn-small"
                          onClick={() => removeFile(file.name)}
                          aria-label="Remove selected file"
                        >
                          <FiX />
                        </button>
                      )}

                      {isCompleted && <FiCheckCircle className="file-status-icon success" />}
                      {isFailed && !isActive && <FiAlertCircle className="file-status-icon error" />}
                      {isActive && <FiLoader className="file-status-icon spinning" />}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </div>

        <div className="tab-actions">
          {onSkip && (
            <button className="btn secondary" onClick={onSkip} disabled={isProcessing}>
              Skip for now
            </button>
          )}

          {isProcessing ? (
            <button className="btn warning" onClick={handleCancel}>
              Cancel Upload
            </button>
          ) : (
            <button
              className="btn primary"
              onClick={handleUpload}
              disabled={!hasFiles || allCompleted}
            >
              {allCompleted ? 'All Done ✓' : 'Upload & Process'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

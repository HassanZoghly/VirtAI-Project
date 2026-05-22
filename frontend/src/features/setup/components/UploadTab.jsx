import { useRef, useState, useEffect } from 'react';
import { FiUploadCloud, FiFileText, FiX, FiCheckCircle, FiAlertCircle } from 'react-icons/fi';
import { useDocumentUpload } from '../../documents/useDocumentUpload';
import { useDocumentList } from '../../documents/useDocumentList';
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

function RealisticProgressBar({ progress, stage, error, filename }) {
  const [displayProgress, setDisplayProgress] = useState(0);

  useEffect(() => {
    if (error) return;
    if (stage === 'COMPLETE') {
      setDisplayProgress(100);
      return;
    }
    
    // Smooth out progress
    if (progress > displayProgress) {
      const step = (progress - displayProgress) * 0.1;
      const timer = requestAnimationFrame(() => {
        setDisplayProgress(prev => Math.min(prev + Math.max(step, 0.5), progress));
      });
      return () => cancelAnimationFrame(timer);
    } else if (progress === 0 && displayProgress < 90 && stage) {
      // Artificial progress while polling but backend is stuck at 0%
      const timer = requestAnimationFrame(() => {
        setDisplayProgress(prev => Math.min(prev + 0.2, 85));
      });
      return () => cancelAnimationFrame(timer);
    }
  }, [progress, displayProgress, stage, error]);

  const getStageText = () => {
    if (error) return 'Upload failed';
    if (stage === 'COMPLETE') return 'Ready';
    if (stage === 'CHUNKING' || stage === 'PROCESSING') return 'Chunking & Processing...';
    if (stage === 'EMBEDDING') return 'Generating embeddings...';
    if (stage === 'QUEUED') return 'In queue...';
    return 'Uploading...';
  };

  return (
    <div className="upload-progress-container">
      <div className="progress-header">
        <span className="progress-stage">{getStageText()}</span>
        {!error && stage !== 'COMPLETE' && (
          <span className="progress-pct">{Math.round(displayProgress)}%</span>
        )}
      </div>

      {!error && (
        <div className="progress-bar-bg" style={{ position: 'relative' }}>
          {filename && stage !== 'COMPLETE' && (
            <div 
              className="progress-floating-marker"
              style={{
                position: 'absolute',
                top: '-28px',
                left: `${displayProgress}%`,
                transform: 'translateX(-50%)',
                background: 'var(--card-bg, #1e1e1e)',
                color: 'var(--text-primary, #fff)',
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                whiteSpace: 'nowrap',
                border: '1px solid var(--border-color, #333)',
                boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
                zIndex: 10,
                transition: 'left 0.1s linear',
              }}
            >
              {filename}
            </div>
          )}
          <div
            className={`progress-bar-fill ${stage === 'COMPLETE' ? 'success' : ''}`}
            style={{ width: `${displayProgress}%` }}
          />
        </div>
      )}

      {error && (
        <div className="upload-error">
          <FiAlertCircle /> {error}
        </div>
      )}

      {stage === 'COMPLETE' && !error && (
        <div className="upload-success">
          <FiCheckCircle /> Document processed and ready.
        </div>
      )}
    </div>
  );
}

export function UploadTab({ onUploaded, onSkip }) {
  const fileInputRef = useRef(null);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [localErrors, setLocalErrors] = useState({});
  const { upload, isUploading, isPolling, progress, stage, error, cancel, reset } = useDocumentUpload();
  const { refresh } = useDocumentList();
  
  // We'll process them sequentially
  const [uploadQueue, setUploadQueue] = useState([]);
  const [currentUploadIndex, setCurrentUploadIndex] = useState(-1);
  const [completedUploads, setCompletedUploads] = useState([]);

  const setFiles = (files) => {
    if (!files || files.length === 0) return;
    
    const newFiles = Array.from(files);
    const validFiles = [];
    const errors = { ...localErrors };
    
    newFiles.forEach(file => {
      // Prevent duplicates
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
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;
    
    // Only upload files that haven't been successfully completed
    const filesToUpload = selectedFiles.filter(f => !completedUploads.includes(f.name));
    if (filesToUpload.length === 0) {
        if (onUploaded) onUploaded();
        return;
    }
    
    setUploadQueue(filesToUpload);
    setCurrentUploadIndex(0);
  };

  // Process queue
  useEffect(() => {
    const processQueue = async () => {
      if (currentUploadIndex >= 0 && currentUploadIndex < uploadQueue.length) {
        const file = uploadQueue[currentUploadIndex];
        try {
          await upload(file);
          setCompletedUploads(prev => [...prev, file.name]);
          refresh();
          setCurrentUploadIndex(prev => prev + 1);
        } catch (err) {
          // Error is handled by the hook, but we stop the queue
          setCurrentUploadIndex(-1);
        }
      } else if (currentUploadIndex === uploadQueue.length && uploadQueue.length > 0) {
        // All done
        setTimeout(() => {
            if (onUploaded) onUploaded();
        }, 900);
      }
    };
    
    // Only trigger if we're not currently uploading
    if (currentUploadIndex >= 0 && !isUploading && !isPolling && currentUploadIndex < uploadQueue.length) {
      // Small timeout to allow state to settle
      const timer = setTimeout(processQueue, 100);
      return () => clearTimeout(timer);
    }
  }, [currentUploadIndex, uploadQueue, isUploading, isPolling, upload, refresh, onUploaded]);

  const handleCancel = () => {
    cancel();
    setUploadQueue([]);
    setCurrentUploadIndex(-1);
  };

  const isProcessingQueue = currentUploadIndex >= 0 && currentUploadIndex < uploadQueue.length;
  const hasFiles = selectedFiles.length > 0;
  const currentFile = isProcessingQueue ? uploadQueue[currentUploadIndex] : null;

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
          className={`upload-area ${hasFiles ? 'has-file' : ''} ${
            isProcessingQueue ? 'disabled' : ''
          }`}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => !isProcessingQueue && fileInputRef.current?.click()}
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
                  const isCurrent = currentFile?.name === file.name;
                  const isCompleted = completedUploads.includes(file.name);
                  const fileError = localErrors[file.name] || (isCurrent && error ? error : null);
                  
                  return (
                    <motion.div 
                      key={file.name} 
                      className={`file-list-item ${isCurrent ? 'processing' : ''} ${isCompleted ? 'completed' : ''} ${fileError ? 'error' : ''}`}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                    >
                      <FiFileText className="file-list-icon" />
                      <div className="file-list-details">
                        <span className="file-list-name">{file.name}</span>
                        <span className="file-list-size">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                        {fileError && <span className="file-list-error-text">{fileError}</span>}
                      </div>
                      
                      {!isProcessingQueue && !isCompleted && (
                        <button
                          className="icon-btn remove-btn-small"
                          onClick={() => removeFile(file.name)}
                          aria-label="Remove selected file"
                        >
                          <FiX />
                        </button>
                      )}
                      
                      {isCompleted && <FiCheckCircle className="file-status-icon success" />}
                      {fileError && !isCurrent && <FiAlertCircle className="file-status-icon error" />}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </div>

        {isProcessingQueue && currentFile && (
          <RealisticProgressBar 
            progress={progress} 
            stage={stage} 
            error={error} 
            filename={currentFile.name}
          />
        )}

        <div className="tab-actions">
          {onSkip && (
              <button className="btn secondary" onClick={onSkip} disabled={isProcessingQueue}>
                Skip for now
              </button>
          )}

          {isProcessingQueue ? (
            <button className="btn warning" onClick={handleCancel}>
              Cancel Upload
            </button>
          ) : (
            <button
              className="btn primary"
              onClick={handleUpload}
              disabled={!hasFiles || selectedFiles.every(f => completedUploads.includes(f.name))}
            >
              Upload & Process
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

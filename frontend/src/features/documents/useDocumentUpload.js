import { useState, useCallback, useRef } from 'react';
import { documentApi } from './documentApi';
import { createPollingTransport } from './transport/createPollingTransport';

function getUploadErrorMessage(err) {
  if (err.response?.status === 413) {
    return 'This file is too large. Upload a PDF, TXT, or MD file up to 25MB.';
  }
  if (err.response?.status === 415) {
    return 'Unsupported file type. Upload a PDF, TXT, or MD file.';
  }
  return err.response?.data?.detail || err.message || 'Upload failed';
}

export function useDocumentUpload(options = {}) {
  const { onSuccess, onError } = options;
  const [uploadState, setUploadState] = useState({
    isUploading: false,
    isPolling: false,
    progress: 0,
    stage: null,
    error: null,
    documentId: null,
    processedChunks: 0,
    totalChunks: 0,
  });

  const cancelPollingRef = useRef(null);

  const reset = useCallback(() => {
    if (cancelPollingRef.current) {
      cancelPollingRef.current();
      cancelPollingRef.current = null;
    }
    setUploadState({
      isUploading: false,
      isPolling: false,
      progress: 0,
      stage: null,
      error: null,
      documentId: null,
      processedChunks: 0,
      totalChunks: 0,
    });
  }, []);

  const cancel = useCallback(async () => {
    if (!uploadState.documentId) {
      return;
    }

    try {
      await documentApi.cancel(uploadState.documentId);
      reset();
      setUploadState((prev) => ({ ...prev, error: 'Upload cancelled' }));
    } catch (err) {
      console.error('Failed to cancel document:', err);
    }
  }, [uploadState.documentId, reset]);

  const upload = useCallback(
    async (file) => {
      reset();
      setUploadState((prev) => ({
        ...prev,
        isUploading: true,
        stage: 'UPLOADING',
        progress: 0,
      }));

      try {
        // 1. Initial upload (returns 202)
        const response = await documentApi.upload(file);
        const docId = response.id;

        setUploadState((prev) => ({
          ...prev,
          isUploading: false,
          isPolling: true,
          documentId: docId,
          stage: response.status === 'COMPLETE' ? 'COMPLETE' : 'QUEUED',
        }));

        if (response.status === 'COMPLETE') {
          if (onSuccess) {
            onSuccess(response);
          }
          return response;
        }

        // 2. Start polling
        return new Promise((resolve, reject) => {
          cancelPollingRef.current = createPollingTransport({
            fetchStatusFn: () => documentApi.getStatus(docId),
            onProgress: (status) => {
              setUploadState((prev) => ({
                ...prev,
                progress: status.progress_pct || 0,
                stage: status.current_stage,
                processedChunks: status.processed_chunks || 0,
                totalChunks: status.total_chunks || 0,
              }));
            },
            onComplete: (status) => {
              setUploadState((prev) => ({
                ...prev,
                isPolling: false,
                progress: 100,
                stage: 'COMPLETE',
              }));
              if (onSuccess) {
                onSuccess(status);
              }
              resolve(status);
            },
            onError: (error) => {
              setUploadState((prev) => ({
                ...prev,
                isPolling: false,
                error: error.message,
                stage: 'FAILED',
              }));
              if (onError) {
                onError(error);
              }
              reject(error);
            },
          });
        });
      } catch (err) {
        const errorMessage = getUploadErrorMessage(err);
        setUploadState((prev) => ({
          ...prev,
          isUploading: false,
          error: errorMessage,
          stage: 'FAILED',
        }));
        if (onError) {
          onError(new Error(errorMessage));
        }
        throw err;
      }
    },
    [reset, onSuccess, onError]
  );

  return {
    ...uploadState,
    upload,
    cancel,
    reset,
  };
}

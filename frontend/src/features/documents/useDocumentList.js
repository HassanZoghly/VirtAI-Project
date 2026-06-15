import { useState, useCallback, useEffect } from 'react';
import { documentApi } from './documentApi';

export function useDocumentList(sessionId = null) {
  const [documents, setDocuments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchDocuments = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await documentApi.list(sessionId);
      setDocuments(data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to fetch documents');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  const deleteDocument = useCallback(async (id) => {
    try {
      await documentApi.delete(id);
      setDocuments((prev) => prev.filter((doc) => doc.id !== id));
    } catch (err) {
      throw new Error(err.response?.data?.detail || 'Failed to delete document');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDocuments();
  }, [fetchDocuments]);

  return {
    documents,
    isLoading,
    error,
    refresh: fetchDocuments,
    deleteDocument,
  };
}

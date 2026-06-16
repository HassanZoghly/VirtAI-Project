import api from '@/core/api/apiClient';

export const documentApi = {
  /**
   * Upload a document for ingestion
   * Returns 202 Accepted with a document ID
   */
  upload: async (file, sessionId = null) => {
    const formData = new FormData();
    formData.append('file', file);
    if (sessionId) {
      formData.append('session_id', sessionId);
    }

    const response = await api.post('/documents/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  /**
   * Get the status of all documents
   */
  list: async (sessionId = null) => {
    let url = `/documents/?t=${Date.now()}`;
    if (sessionId) {
      url += `&session_id=${sessionId}`;
    }
    const response = await api.get(url);
    return response.data;
  },

  /**
   * Get the status of all active documents (processing, queued, etc)
   */
  listActive: async () => {
    const response = await api.get('/documents/status?active_only=true');
    return response.data;
  },

  /**
   * Get the detailed status of a specific document
   */
  getStatus: async (documentId) => {
    const response = await api.get(`/documents/${documentId}/status`);
    return response.data;
  },

  /**
   * Cancel an ongoing document ingestion
   */
  cancel: async (documentId) => {
    const response = await api.post(`/documents/${documentId}/cancel`);
    return response.data;
  },

  /**
   * Delete a document completely
   */
  delete: async (documentId) => {
    const response = await api.delete(`/documents/${documentId}`);
    return response.data;
  },
};

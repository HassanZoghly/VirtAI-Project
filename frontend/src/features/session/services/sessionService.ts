import apiClient from '@/core/api/apiClient';

/**
 * Fetch all chat sessions for the current user.
 */
export async function fetchSessions(): Promise<any[]> {
  const response = await apiClient.get('/chat/');
  return Array.isArray(response.data) ? response.data : (response.data?.sessions || response.data?.data || []);
}

/**
 * Create a new chat session on the backend.
 */
export async function createSession(): Promise<any> {
  const response = await apiClient.post('/chat/');
  return response.data;
}

/**
 * Fetch message history for a specific session.
 */
export async function fetchSessionMessages(sessionId: string, options: any = {}): Promise<any[]> {
  const response = await apiClient.get(`/chat/${sessionId}/messages`, options);
  return Array.isArray(response.data) ? response.data : (response.data?.messages || response.data?.data || []);
}

/**
 * Delete a specific chat session.
 */
export async function deleteSession(sessionId: string): Promise<any> {
  const response = await apiClient.delete(`/chat/${sessionId}`);
  return response.data;
}

/**
 * Delete all chat sessions for the user.
 */
export async function deleteAllSessions(): Promise<any> {
  const response = await apiClient.delete('/chat/all');
  return response.data;
}

/**
 * Generate a smart title based on the first user message.
 */
export async function generateSmartTitle(sessionId: string, firstUserMessage: string): Promise<string> {
  try {
    const response = await apiClient.post(`/chat/${sessionId}/title`, { message: firstUserMessage });
    return response.data?.title || `Conversation ${new Date().toLocaleDateString()}`;
  } catch (error) {
    console.error('Failed to generate smart title:', error);
    return `Conversation ${new Date().toLocaleDateString()}`;
  }
}

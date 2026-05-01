import apiClient from '@/shared/services/apiClient';
import { extractCollection } from '../utils/sessionState';

/**
 * Fetch all chat sessions for the current user.
 */
export async function fetchSessions() {
  const response = await apiClient.get('/chat/');
  return extractCollection(response.data, ['sessions', 'messages', 'data', 'items']);
}

/**
 * Create a new chat session on the backend.
 */
export async function createSession() {
  const response = await apiClient.post('/chat/');
  return response.data;
}

/**
 * Fetch message history for a specific session.
 */
export async function fetchSessionMessages(sessionId, options = {}) {
  const response = await apiClient.get(`/chat/${sessionId}/messages`, options);
  return extractCollection(response.data, ['messages', 'sessions', 'data', 'items']);
}

/**
 * Delete a specific chat session.
 */
export async function deleteSession(sessionId) {
  const response = await apiClient.delete(`/chat/${sessionId}`);
  return response.data;
}

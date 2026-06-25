import apiClient from '@/core/api/apiClient';
import { z } from 'zod';
import { formatDateOnly } from '@/shared/utils/date';

const sessionSchema = z.object({
  id: z.string(),
  user_id: z.string().optional(),
  title: z.string(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  message_count: z.number().optional(),
}).passthrough();

const sessionsResponseSchema = z.array(sessionSchema);

const messageSchema = z.object({
  id: z.string(),
  session_id: z.string(),
  role: z.string(),
  content: z.string(),
  timestamp: z.string().nullable().optional(),
}).passthrough();

const messagesResponseSchema = z.array(messageSchema);

/**
 * Fetch all chat sessions for the current user.
 */
export async function fetchSessions(): Promise<any[]> {
  const response = await apiClient.get('/chat/');
  const rawData = Array.isArray(response.data)
    ? response.data
    : response.data?.sessions || [];
  const parsed = sessionsResponseSchema.safeParse(rawData);
  if (!parsed.success) {
    console.error('[API Contract Error] fetchSessions response deviated from expected schema:', parsed.error);
    throw new Error('Invalid sessions format received from backend');
  }
  return parsed.data;
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
  const rawData = Array.isArray(response.data)
    ? response.data
    : response.data?.messages || [];
  const parsed = messagesResponseSchema.safeParse(rawData);
  if (!parsed.success) {
    console.error('[API Contract Error] fetchSessionMessages response deviated from expected schema:', parsed.error);
    throw new Error('Invalid messages format received from backend');
  }
  return parsed.data;
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
export async function generateSmartTitle(sessionId: string, firstUserMessage: string, options?: { signal?: AbortSignal }): Promise<string> {
  try {
    const response = await apiClient.post(`/chat/${sessionId}/title`, { message: firstUserMessage }, options);
    return response.data?.title || `Conversation ${formatDateOnly(Date.now())}`;
  } catch (error: unknown) {
    if (error instanceof Error && (error.name === 'CanceledError' || error.message?.includes('aborted'))) {
      throw error; // Let react query handle the abort
    }
    console.error('Failed to generate smart title:', error);
    return `Conversation ${formatDateOnly(Date.now())}`;
  }
}

/**
 * Rename a chat session manually.
 */
export async function renameSession(sessionId: string, title: string): Promise<any> {
  const response = await apiClient.patch(`/chat/${sessionId}`, { title });
  return response.data;
}

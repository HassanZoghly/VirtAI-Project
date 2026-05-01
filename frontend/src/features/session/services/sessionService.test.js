import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '@/shared/services/apiClient';
import { fetchSessionMessages, fetchSessions } from './sessionService';

vi.mock('@/shared/services/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('sessionService response extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('unwraps wrapped sessions payloads', async () => {
    apiClient.get.mockResolvedValueOnce({ data: { sessions: [{ id: 's1' }] } });

    const sessions = await fetchSessions();

    expect(sessions).toEqual([{ id: 's1' }]);
  });

  it('returns [] when sessions payload is not an array', async () => {
    apiClient.get.mockResolvedValueOnce({ data: { ok: true } });

    const sessions = await fetchSessions();

    expect(sessions).toEqual([]);
  });

  it('unwraps wrapped messages payloads', async () => {
    apiClient.get.mockResolvedValueOnce({ data: { messages: [{ id: 'm1' }] } });

    const messages = await fetchSessionMessages('session-1');

    expect(messages).toEqual([{ id: 'm1' }]);
  });
});


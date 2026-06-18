import apiClient from '@/core/api/apiClient';
import { beforeEach, describe, expect, it, MockedFunction, vi } from 'vitest';
import { fetchSessionMessages, fetchSessions } from './sessionService';

vi.mock('@/core/api/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockGet = apiClient.get as MockedFunction<typeof apiClient.get>;

describe('sessionService response extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('unwraps wrapped sessions payloads', async () => {
    mockGet.mockResolvedValueOnce({ data: { sessions: [{ id: 's1' }] } } as any);

    const sessions = await fetchSessions();

    expect(sessions).toEqual([{ id: 's1' }]);
  });

  it('returns [] when sessions payload is not an array', async () => {
    mockGet.mockResolvedValueOnce({ data: { ok: true } } as any);

    const sessions = await fetchSessions();

    expect(sessions).toEqual([]);
  });

  it('unwraps wrapped messages payloads', async () => {
    mockGet.mockResolvedValueOnce({ data: { messages: [{ id: 'm1' }] } } as any);

    const messages = await fetchSessionMessages('session-1');

    expect(messages).toEqual([{ id: 'm1' }]);
  });
});

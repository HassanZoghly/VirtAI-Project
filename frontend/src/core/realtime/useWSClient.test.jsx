/* @vitest-environment happy-dom */
import { refreshAccessTokenSingleFlight } from '@/features/auth/services/refreshService';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useWSClient from './useWSClient';

const mockStore = { accessToken: 'test-access-token', logout: vi.fn() };

vi.mock('@/features/auth/store/authStore', () => {
  const useAuthStore = (selector) => selector(mockStore);
  useAuthStore.getState = () => mockStore;
  useAuthStore.setState = vi.fn((state) => Object.assign(mockStore, state));
  return { useAuthStore };
});

vi.mock('@/shared/utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

vi.mock('@/features/auth/services/refreshService', () => ({
  refreshAccessTokenSingleFlight: vi.fn(),
}));

vi.mock('@/features/auth/services/authStateCleanup', () => ({
  clearBrowserAuthState: vi.fn(),
}));

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this.send = vi.fn();
    this.close = vi.fn(() => {
      this.readyState = MockWebSocket.CLOSING;
    });
    MockWebSocket.instances.push(this);
  }

  emitOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  emitMessage(data) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  emitClose(code = 1006, reason = 'abnormal') {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
}

describe('useWSClient lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    globalThis.WebSocket = MockWebSocket;
    mockStore.accessToken = 'test-access-token';
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('closes the previous socket on URL change even while CONNECTING', () => {
    const { rerender, unmount } = renderHook(({ url }) => useWSClient(url), {
      initialProps: { url: 'ws://localhost/ws/chat/old-session' },
    });

    const firstSocket = MockWebSocket.instances[0];
    expect(firstSocket.readyState).toBe(MockWebSocket.CONNECTING);

    rerender({ url: 'ws://localhost/ws/chat/new-session' });

    expect(firstSocket.onclose).toBe(null);
    expect(firstSocket.close).toHaveBeenCalledWith(1000);

    unmount();
  });

  it('does not reconnect to stale URL after URL switches', () => {
    const { rerender, unmount } = renderHook(({ url }) => useWSClient(url), {
      initialProps: { url: 'ws://localhost/ws/chat/old-session' },
    });

    const oldSocket = MockWebSocket.instances[0];
    const staleOnClose = oldSocket.onclose;

    rerender({ url: 'ws://localhost/ws/chat/new-session' });

    act(() => {
      staleOnClose?.({ code: 1006, reason: 'stale-close-event' });
      vi.runOnlyPendingTimers();
    });

    const oldUrlConnections = MockWebSocket.instances.filter((socket) =>
      String(socket.url).includes('/ws/chat/old-session')
    );
    const newUrlConnections = MockWebSocket.instances.filter((socket) =>
      String(socket.url).includes('/ws/chat/new-session')
    );

    expect(oldUrlConnections).toHaveLength(1);
    expect(newUrlConnections.length).toBeGreaterThanOrEqual(1);

    unmount();
  });

  it('never reconnects after URL becomes null', () => {
    const { rerender, unmount } = renderHook(({ url }) => useWSClient(url), {
      initialProps: { url: 'ws://localhost/ws/chat/original-session' },
    });

    const socket = MockWebSocket.instances[0];

    act(() => {
      socket.emitClose(1006, 'network');
    });

    rerender({ url: null });

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(MockWebSocket.instances).toHaveLength(1);

    unmount();
  });

  it('fast-fail detection: purges resume state if closed <2000ms', () => {
    const { unmount } = renderHook(() => useWSClient('ws://localhost/ws/chat/fast-fail'));

    const socket = MockWebSocket.instances[0];
    act(() => {
      socket.emitOpen();
      socket.emitMessage({ type: 'ready', data: { session_id: 'active-sess-id', last_seq: 5 } });
      vi.advanceTimersByTime(500); // Wait 500ms (less than 2000ms)
      socket.emitClose(1006, 'fast-fail-network');
    });

    act(() => {
      vi.runOnlyPendingTimers(); // trigger reconnect
    });

    const nextSocket = MockWebSocket.instances[1];
    expect(nextSocket.url).not.toContain('resume=true');
    expect(nextSocket.url).not.toContain('session_id=active-sess-id');

    unmount();
  });

  it('4404 invalid session handler: purges resume state', () => {
    const { unmount } = renderHook(() => useWSClient('ws://localhost/ws/chat/session-4404'));

    const socket = MockWebSocket.instances[0];
    act(() => {
      socket.emitOpen();
      socket.emitMessage({ type: 'ready', data: { session_id: 'bad-session', last_seq: 10 } });
      vi.advanceTimersByTime(3000); // longer than fast-fail
      socket.emitClose(4404, 'Session invalid');
    });

    act(() => {
      vi.runOnlyPendingTimers(); // trigger reconnect
    });

    const nextSocket = MockWebSocket.instances[1];
    expect(nextSocket.url).not.toContain('resume=true');
    expect(nextSocket.url).not.toContain('session_id=bad-session');

    unmount();
  });

  it('4401 Token Expiration: triggers 1 HTTP refresh, then reconnects', async () => {
    refreshAccessTokenSingleFlight.mockResolvedValueOnce({ access_token: 'new-token' });

    const { unmount } = renderHook(() => useWSClient('ws://localhost/ws/chat/token-4401'));

    const socket = MockWebSocket.instances[0];

    await act(async () => {
      socket.emitClose(4401, 'Token expired');
      await Promise.resolve(); // flush promise microtasks
    });

    expect(refreshAccessTokenSingleFlight).toHaveBeenCalledTimes(1);

    const nextSocket = MockWebSocket.instances[1];
    expect(nextSocket).toBeDefined();
    expect(mockStore.accessToken).toBe('new-token');
    expect(nextSocket.url).toContain('ws://localhost/ws/chat/token-4401');

    unmount();
  });

});

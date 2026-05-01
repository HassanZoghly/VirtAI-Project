/* @vitest-environment happy-dom */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useWSClient from './useWSClient';

vi.mock('@/features/auth/store/authStore', () => ({
  useAuthStore: (selector) => selector({ accessToken: 'test-access-token' }),
}));

vi.mock('@/shared/utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
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
});

import { useAuthStore } from '@/features/auth/store/authStore';
import { useCallback, useEffect, useRef } from 'react';
import type { WSOutgoingMessage } from './types';
import { useWSConnectionManager } from './useWSConnectionManager';
import { useWSMessageQueue } from './useWSMessageQueue';
import { useWSSessionManager } from './useWSSessionManager';
import { ConnectionState, WS_CLOSE_NORMAL } from './wsConstants';

export { ConnectionState } from './wsConstants';

export default function useWSClient(url: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const urlRef = useRef<string | null>(url);
  const accessToken = useAuthStore((state) => state.accessToken);
  const accessTokenRef = useRef<string | null>(accessToken);
  const lastErrorTimeRef = useRef<number>(0);

  const logBackendOffline = useCallback(() => {
    const now = Date.now();
    if (now - lastErrorTimeRef.current > 10000) {
      if (import.meta.env.DEV) {
        console.warn('[WS] ⚠️ Backend offline — will retry with exponential backoff');
        console.info('[WS] 💡 Start backend: cd backend && python -m uvicorn app.main:app --reload');
      }
      lastErrorTimeRef.current = now;
    }
  }, []);

  const {
    sessionStateRef,
    scheduleAck,
    resetSession,
    clearAckTimer,
  } = useWSSessionManager();

  const {
    eventRouterRef,
    send: messageQueueSend,
    onMessage,
    flushQueue,
  } = useWSMessageQueue();

  const {
    connectionState,
    reconnectError,
    connect,
    disconnect,
    reconnect,
    mount,
    unmount,
    clearReconnectTimer,
  } = useWSConnectionManager({
    wsRef,
    urlRef,
    accessTokenRef,
    sessionStateRef,
    eventRouterRef,
    scheduleAck,
    flushQueue,
    resetSession,
    clearAckTimer,
    logBackendOffline,
  });

  const isConnected = connectionState === ConnectionState.ONLINE;

  // Keep accessTokenRef in sync and close the socket when the token rotates.
  useEffect(() => {
    if (accessToken !== accessTokenRef.current) {
      if (wsRef.current) {
        wsRef.current.close(WS_CLOSE_NORMAL, 'Token refreshed');
      }
    }
    accessTokenRef.current = accessToken;
  }, [accessToken]);

  // Keep urlRef in sync.
  useEffect(() => {
    urlRef.current = url;
  }, [url]);

  // Mount / unmount lifecycle.
  useEffect(() => {
    mount();
    let timerId: ReturnType<typeof setTimeout> | null = null;

    if (!url) {
      clearReconnectTimer();
      unmount();
      return;
    }

    // Debounce the connection attempt to handle React Strict Mode double-mounts.
    timerId = setTimeout(() => {
      connect(url, null);
    }, 500);

    return () => {
      if (timerId) clearTimeout(timerId);
      unmount();
    };
  }, [url, mount, unmount, connect, clearReconnectTimer]);

  // Re-connect when the token becomes available (e.g. after a silent refresh)
  // and there is no live socket yet. We pass the token explicitly so that the
  // connection manager never reads a stale ref value — the freshly received
  // `accessToken` from the Zustand selector is the ground truth here.
  useEffect(() => {
    if (
      accessToken &&
      urlRef.current &&
      !wsRef.current &&
      connectionState !== ConnectionState.RECONNECTING
    ) {
      connect(null, accessToken);
    }
    // `connect` is stable (useCallback). `connectionState` is intentionally
    // excluded: we only want to fire when the *token* changes, not on every
    // connection-state transition (which would cause infinite reconnect loops).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);


  const send = useCallback(
    (message: WSOutgoingMessage) => {
      messageQueueSend(message, wsRef, sessionStateRef);
    },
    [messageQueueSend, sessionStateRef]
  );

  return {
    connectionState,
    isConnected,
    send,
    onMessage,
    disconnect,
    reconnect,
    reconnectError,
  };
}

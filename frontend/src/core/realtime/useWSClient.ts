import { useAuthStore } from '@/features/auth/store/authStore';
import { useCallback, useEffect, useRef } from 'react';
import type { WSOutgoingMessage } from './types';
import { useWSConnectionManager } from './useWSConnectionManager';
import { useWSMessageQueue } from './useWSMessageQueue';
import { useWSSessionManager } from './useWSSessionManager';
import { ConnectionState, WS_CLOSE_NORMAL } from './wsConstants';

export { ConnectionState } from './wsConstants';

export default function useWSClient(url: string | null, currentSessionId?: string | null) {
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
    if (!url) {
      clearReconnectTimer();
      unmount();
      return;
    }
    connect(url);
    return () => {
      unmount();
    };
  }, [url, mount, unmount, connect, clearReconnectTimer]);

  // Re-connect when the token becomes available (e.g. after a silent refresh)
  // and there is no live socket yet.
  // NOTE: `connect` and `connectionState` are intentionally omitted from the
  // dependency array here. `connect` is stable (wrapped in useCallback with
  // stable deps) but adding it would trigger an extra connect on every render
  // where `connectionState` changes, causing an infinite reconnect loop.
  // `urlRef` and `accessTokenRef` are refs, so they never trigger re-renders.
  // The only trigger we need is `accessToken` changing.
  const connectRef = useRef(connect);
  useEffect(() => {
    connectRef.current = connect;
  });

  useEffect(() => {
    if (
      accessToken &&
      urlRef.current &&
      !wsRef.current &&
      connectionState !== ConnectionState.RECONNECTING
    ) {
      connectRef.current();
    }
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

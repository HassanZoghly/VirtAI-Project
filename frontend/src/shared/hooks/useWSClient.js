import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Connection states for the WebSocket lifecycle.
 *
 *   offline       – no socket, no reconnect scheduled (initial or gave-up)
 *   reconnecting  – a reconnect timer is ticking / socket is being created
 *   initializing  – TCP handshake done (onopen), waiting for first server message
 *   online        – fully connected and ready
 */
export const ConnectionState = Object.freeze({
  OFFLINE: 'offline',
  RECONNECTING: 'reconnecting',
  INITIALIZING: 'initializing',
  ONLINE: 'online',
});

/**
 * Linear backoff: 1 s → 2 s → 3 s → … → 10 s max.
 */
const backoffDelay = (attempt) => Math.min((attempt + 1) * 1000, 10_000);

/**
 * WebSocket client hook with automatic reconnection and connection-state machine.
 *
 * @param {string} url - WebSocket server URL
 * @returns {{ connectionState: string, isConnected: boolean, send: Function, onMessage: Function, disconnect: Function }}
 */
function useWSClient(url) {
  const [connectionState, setConnectionState] = useState(ConnectionState.OFFLINE);

  // Derived boolean kept for backward compat
  const isConnected = connectionState === ConnectionState.ONLINE;

  const messageQueue = useRef([]);
  const reconnectAttempts = useRef(0);
  const handlers = useRef({});
  const reconnectTimeoutRef = useRef(null);
  const wsRef = useRef(null);
  const isIntentionalCloseRef = useRef(false);
  const isConnectingRef = useRef(false);
  const lastErrorTimeRef = useRef(0);
  const mountIdRef = useRef(Math.random());
  const initTimerRef = useRef(null); // timer for initializing→online transition

  const connect = useCallback(() => {
    // STRICT CONNECTION GUARD: Never create new WS if one exists in CONNECTING/OPEN
    if (wsRef.current) {
      const state = wsRef.current.readyState;
      if (state === WebSocket.CONNECTING || state === WebSocket.OPEN) {
        if (import.meta.env.DEV) {
          console.debug(
            '[WS] Socket already exists in state:',
            ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][state]
          );
        }
        return;
      }
    }

    // Prevent multiple simultaneous connection attempts
    if (isConnectingRef.current) {
      if (import.meta.env.DEV) {
        console.debug('[WS] Connection already in progress, skipping');
      }
      return;
    }

    isConnectingRef.current = true;
    const currentMountId = mountIdRef.current;
    const instanceId = Math.random().toString(36).substring(7);

    // Only show "reconnecting" if this is a retry (not the very first connect)
    if (reconnectAttempts.current > 0) {
      setConnectionState(ConnectionState.RECONNECTING);
    }

    try {
      const socket = new WebSocket(url);
      wsRef.current = socket;
      socket._mountId = currentMountId;
      socket._instanceId = instanceId;
      isIntentionalCloseRef.current = false;

      if (import.meta.env.DEV) {
        console.debug('[WS] Creating new WebSocket, state: CONNECTING');
      }

      socket.onopen = () => {
        if (socket._instanceId !== instanceId) {
          socket.close();
          return;
        }
        if (socket._mountId !== mountIdRef.current) {
          socket.close();
          return;
        }

        isConnectingRef.current = false;

        if (import.meta.env.DEV) {
          console.debug('[WS] State transition: → INITIALIZING');
        }

        // Enter brief "initializing" phase so the UI can show a handshake state
        setConnectionState(ConnectionState.INITIALIZING);

        // Transition to ONLINE after a short delay (lets the server send 'ready')
        // If we receive a 'ready' message earlier, we promote immediately.
        initTimerRef.current = setTimeout(() => {
          initTimerRef.current = null;
          setConnectionState((prev) =>
            prev === ConnectionState.INITIALIZING ? ConnectionState.ONLINE : prev
          );
        }, 800);

        reconnectAttempts.current = 0;

        if (import.meta.env.DEV) {
          console.log('[WS] ✅ Connected to backend');
        }

        // Flush message queue
        while (messageQueue.current.length > 0) {
          const msg = messageQueue.current.shift();
          try {
            socket.send(JSON.stringify(msg));
          } catch (err) {
            console.error('[WS] Failed to send queued message:', err);
          }
        }
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (!message.type) {
            if (import.meta.env.DEV) {
              console.warn('[WS] Invalid message: missing type field', message);
            }
            return;
          }

          // 'ready' / 'pong' are control messages — use 'ready' to promote to ONLINE early
          if (message.type === 'ready') {
            if (initTimerRef.current) {
              clearTimeout(initTimerRef.current);
              initTimerRef.current = null;
            }
            setConnectionState(ConnectionState.ONLINE);
            if (import.meta.env.DEV) {
              console.debug('[WS] Received ready — promoted to ONLINE');
            }
            return;
          }

          if (message.type === 'pong') {
            if (import.meta.env.DEV) {
              console.debug('[WS] Received pong');
            }
            return;
          }

          // Dispatch to registered handlers
          const typeHandlers = handlers.current[message.type];
          if (typeHandlers && typeHandlers.size > 0) {
            const data = message.data || message;
            typeHandlers.forEach((handler) => handler(data));
          } else if (import.meta.env.DEV) {
            console.warn('[WS] Unknown message type:', message.type);
          }
        } catch (err) {
          console.error('[WS] Failed to parse message:', err);
        }
      };

      socket.onerror = () => {
        const state = socket.readyState;

        if (isIntentionalCloseRef.current) {
          if (import.meta.env.DEV) {
            console.debug(
              '[WS] Error during intentional close (suppressed), state:',
              ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][state]
            );
          }
          return;
        }

        if (import.meta.env.DEV) {
          console.debug(
            '[WS] Error event, state:',
            ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][state]
          );
        }

        const now = Date.now();
        if (now - lastErrorTimeRef.current > 10000) {
          if (import.meta.env.DEV) {
            console.warn('[WS] ⚠️ Backend offline — will retry automatically');
            console.info(
              '[WS] 💡 Start backend: cd backend && python -m uvicorn app.main:app --reload'
            );
          }
          lastErrorTimeRef.current = now;
        }
      };

      socket.onclose = (event) => {
        if (socket._instanceId !== instanceId) return;
        if (socket._mountId !== mountIdRef.current) return;

        const wasIntentional = isIntentionalCloseRef.current;

        if (import.meta.env.DEV) {
          console.debug(
            `[WS] → CLOSED (code: ${event.code}, reason: "${event.reason || 'none'}", intentional: ${wasIntentional})`
          );
        }

        isConnectingRef.current = false;
        wsRef.current = null;

        // Clear initializing timer if still running
        if (initTimerRef.current) {
          clearTimeout(initTimerRef.current);
          initTimerRef.current = null;
        }

        if (wasIntentional) {
          setConnectionState(ConnectionState.OFFLINE);
          return;
        }

        // Normal close — don't reconnect
        if (event.code === 1000 || event.code === 1001) {
          setConnectionState(ConnectionState.OFFLINE);
          return;
        }

        // Abnormal close — schedule reconnect with linear backoff
        const delay = backoffDelay(reconnectAttempts.current);
        reconnectAttempts.current += 1;

        if (import.meta.env.DEV) {
          console.debug(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current})`);
        }

        setConnectionState(ConnectionState.RECONNECTING);

        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          connect();
        }, delay);
      };
    } catch (err) {
      isConnectingRef.current = false;

      const now = Date.now();
      if (now - lastErrorTimeRef.current > 10000) {
        if (import.meta.env.DEV) {
          console.warn('[WS] ⚠️ Backend offline — will retry automatically');
          console.info(
            '[WS] 💡 Start backend: cd backend && python -m uvicorn app.main:app --reload'
          );
        }
        lastErrorTimeRef.current = now;
      }

      const delay = backoffDelay(reconnectAttempts.current);
      reconnectAttempts.current += 1;

      setConnectionState(ConnectionState.RECONNECTING);

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectTimeoutRef.current = null;
        connect();
      }, delay);
    }
  }, [url]);

  // Initialize connection on mount
  useEffect(() => {
    mountIdRef.current = Math.random();
    connect();

    return () => {
      if (import.meta.env.DEV) {
        console.debug('[WS] Cleanup: marking intentional close');
      }

      isIntentionalCloseRef.current = true;
      isConnectingRef.current = false;

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (initTimerRef.current) {
        clearTimeout(initTimerRef.current);
        initTimerRef.current = null;
      }

      if (wsRef.current) {
        const socket = wsRef.current;
        const state = socket.readyState;

        if (import.meta.env.DEV) {
          console.debug(
            '[WS] Cleanup: detaching handlers, state:',
            ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][state]
          );
        }

        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;

        if (state === WebSocket.OPEN || state === WebSocket.CLOSING) {
          socket.close(1000, 'Component unmount');
        }

        wsRef.current = null;
      }
    };
  }, [connect]);

  /**
   * Send a message through WebSocket.
   * JSON messages are queued when offline; binary data is dropped (time-sensitive).
   */
  const send = useCallback(
    (message) => {
      const isBinary =
        message instanceof ArrayBuffer || message instanceof Blob || ArrayBuffer.isView(message);

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(isBinary ? message : JSON.stringify(message));
        } catch (err) {
          console.error('[WS] Failed to send message:', err);
          if (!isBinary) messageQueue.current.push(message);
        }
      } else if (!isBinary) {
        messageQueue.current.push(message);
      }
    },
    [] // no dependency on isConnected — uses wsRef.current.readyState directly
  );

  /**
   * Register a handler for a specific message type. Returns an unsubscribe function.
   */
  const onMessage = useCallback((type, handler) => {
    if (!handlers.current[type]) {
      handlers.current[type] = new Set();
    }
    handlers.current[type].add(handler);

    return () => {
      const set = handlers.current[type];
      if (set) {
        set.delete(handler);
        if (set.size === 0) delete handlers.current[type];
      }
    };
  }, []);

  /**
   * Manually disconnect. Prevents automatic reconnection.
   */
  const disconnect = useCallback(() => {
    isIntentionalCloseRef.current = true;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (initTimerRef.current) {
      clearTimeout(initTimerRef.current);
      initTimerRef.current = null;
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnectionState(ConnectionState.OFFLINE);
  }, []);

  return {
    connectionState,
    isConnected,
    send,
    onMessage,
    disconnect,
  };
}

export default useWSClient;

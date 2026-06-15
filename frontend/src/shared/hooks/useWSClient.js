import { useAuthStore } from '@/features/auth/store/authStore';
import { clearBrowserAuthState } from '@/features/auth/services/authStateCleanup';
import { refreshAccessTokenSingleFlight } from '@/features/auth/services/refreshService';
import { logger } from '@/shared/utils/logger';
import { useCallback, useEffect, useRef, useState } from 'react';

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
 * Generates an exponential backoff with jitter
 * @param {number} attempt
 * @returns {number} Delay in milliseconds
 */
const backoffDelay = (attempt) => Math.min(1000 * 2 ** attempt, 16_000) + Math.random() * 1000;

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_PAUSE_MESSAGE = 'Connection paused after 5 retries. Click Reconnect to try again.';

/**
 * WebSocket client hook with automatic reconnection and connection-state machine.
 *
 * @param {string} url - WebSocket server URL
 * @returns {{ connectionState: string, isConnected: boolean, send: Function, onMessage: Function, disconnect: Function, reconnect: Function, reconnectError: string | null }}
 */
function useWSClient(url) {
  const [connectionState, setConnectionState] = useState(ConnectionState.OFFLINE);
  const [reconnectError, setReconnectError] = useState(null);
  const accessToken = useAuthStore((state) => state.accessToken);

  // Derived boolean kept for backward compat
  const isConnected = connectionState === ConnectionState.ONLINE;

  const messageQueue = useRef([]);
  const reconnectAttempts = useRef(0);
  const handlers = useRef({});
  const reconnectTimeoutRef = useRef(null);
  const wsRef = useRef(null);
  const sessionIdRef = useRef(null);
  const lastSeqRef = useRef(0);
  const lastAckedSeqRef = useRef(0);
  const ackTimerRef = useRef(null);
  const isIntentionalCloseRef = useRef(false);
  const isConnectingRef = useRef(false);
  const lastErrorTimeRef = useRef(0);
  const mountIdRef = useRef(0);
  const initTimerRef = useRef(null); // timer for initializing→online transition
  const reconnectPausedRef = useRef(false);
  const connectRef = useRef(() => {});
  const accessTokenRef = useRef(accessToken);
  const urlRef = useRef(url);
  // Tracks the timestamp when the socket last transitioned to OPEN,
  // used to detect fast-fail closes (session stale → clear resume state).
  const connectedAtRef = useRef(0);
  const authRefreshAttemptsRef = useRef(0);

  useEffect(() => {
    if (accessToken !== accessTokenRef.current) {
      if (wsRef.current) {
        wsRef.current.close(1000, 'Token refreshed');
      }
    }
    accessTokenRef.current = accessToken;
  }, [accessToken]);

  useEffect(() => {
    urlRef.current = url;
  }, [url]);

  useEffect(() => {
    if (
      accessTokenRef.current &&
      urlRef.current &&
      !wsRef.current &&
      !isConnectingRef.current &&
      !reconnectPausedRef.current &&
      !isIntentionalCloseRef.current
    ) {
      connectRef.current();
    }
  }, [accessToken]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const cleanupTimers = useCallback(() => {
    clearReconnectTimer();
    if (ackTimerRef.current) {
      clearTimeout(ackTimerRef.current);
      ackTimerRef.current = null;
    }
    if (initTimerRef.current) {
      clearTimeout(initTimerRef.current);
      initTimerRef.current = null;
    }
  }, [clearReconnectTimer]);

  const logBackendOffline = useCallback(() => {
    const now = Date.now();
    if (now - lastErrorTimeRef.current > 10000) {
      if (import.meta.env.DEV) {
        console.warn('[WS] ⚠️ Backend offline — will retry with exponential backoff');
        console.info(
          '[WS] 💡 Start backend: cd backend && python -m uvicorn app.main:app --reload'
        );
      }
      lastErrorTimeRef.current = now;
    }
  }, []);

  const clearReconnectState = useCallback(() => {
    reconnectPausedRef.current = false;
    reconnectAttempts.current = 0;
    setReconnectError(null);
  }, []);

  const pauseReconnect = useCallback(() => {
    clearReconnectTimer();
    reconnectPausedRef.current = true;
    setReconnectError(RECONNECT_PAUSE_MESSAGE);
    setConnectionState(ConnectionState.OFFLINE);
  }, [clearReconnectTimer]);

  const scheduleReconnect = useCallback(
    (reason, expectedUrl = urlRef.current) => {
      const latestUrl = urlRef.current;
      if (!latestUrl || (expectedUrl && latestUrl !== expectedUrl)) {
        clearReconnectTimer();
        setConnectionState(ConnectionState.OFFLINE);
        return;
      }

      if (reconnectPausedRef.current) {
        return;
      }

      if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
        if (import.meta.env.DEV) {
          console.error('[WS] Maximum reconnect attempts reached (5). Pausing retries.');
          if (reason) {
            console.warn('[WS] Last reconnect reason:', reason);
          }
        }
        pauseReconnect();
        return;
      }

      const delay = backoffDelay(reconnectAttempts.current);
      reconnectAttempts.current += 1;

      if (import.meta.env.DEV) {
        console.debug(
          `[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current}/${MAX_RECONNECT_ATTEMPTS})`
        );
      }

      setReconnectError(null);
      setConnectionState(ConnectionState.RECONNECTING);

      clearReconnectTimer();
      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectTimeoutRef.current = null;
        const activeUrl = urlRef.current;
        if (!activeUrl || activeUrl !== expectedUrl) {
          return;
        }
        connectRef.current(expectedUrl);
      }, delay);
    },
    [clearReconnectTimer, pauseReconnect]
  );

  const flushAck = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    if (lastSeqRef.current <= lastAckedSeqRef.current) {
      return;
    }

    const ackPayload = {
      type: 'ws.ack',
      data: {
        last_seq: lastSeqRef.current,
        session_id: sessionIdRef.current,
      },
    };

    try {
      wsRef.current.send(JSON.stringify(ackPayload));
      lastAckedSeqRef.current = lastSeqRef.current;
    } catch (err) {
      if (import.meta.env.DEV) {
        console.debug('[WS] Failed to send ack payload:', err);
      }
    }
  }, []);

  const scheduleAck = useCallback(() => {
    if (ackTimerRef.current) {
      return;
    }
    ackTimerRef.current = setTimeout(() => {
      ackTimerRef.current = null;
      flushAck();
    }, 80);
  }, [flushAck]);

  const connect = useCallback(
    (overrideUrl = null) => {
      const currentUrl = overrideUrl || urlRef.current;

      if (!currentUrl) {
        if (import.meta.env.DEV) {
          console.debug('[WS] URL is null or undefined, skipping connection');
        }
        clearReconnectTimer();
        setConnectionState(ConnectionState.OFFLINE);
        return;
      }

      if (reconnectPausedRef.current) {
        if (import.meta.env.DEV) {
          console.debug('[WS] Reconnect paused; waiting for manual retry');
        }
        return;
      }

      if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
        pauseReconnect();
        if (import.meta.env.DEV) {
          console.debug('[WS] Reconnect limit reached; waiting for manual retry');
        }
        return;
      }

      const currentAccessToken = accessTokenRef.current;
      if (!currentAccessToken) {
        clearReconnectTimer();
        setConnectionState(ConnectionState.OFFLINE);
        if (import.meta.env.DEV) {
          console.debug('[WS] Waiting for access token before connecting');
        }
        return;
      }

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
        let socketUrl = currentUrl;
        try {
          const parsed = new URL(currentUrl);
          if (sessionIdRef.current) {
            parsed.searchParams.set('resume', 'true');
            parsed.searchParams.set('session_id', sessionIdRef.current);
            parsed.searchParams.set('last_seq', String(lastSeqRef.current));
          }
          socketUrl = parsed.toString();
        } catch {
          // Keep original URL for non-standard runtimes.
        }

        const protocols = currentAccessToken ? ['access_token', currentAccessToken] : [];
        const socket = new WebSocket(socketUrl, protocols);
        wsRef.current = socket;
        socket._mountId = currentMountId;
        socket._instanceId = instanceId;
        socket._sourceUrl = currentUrl;
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
          connectedAtRef.current = Date.now();

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
          authRefreshAttemptsRef.current = 0;

          if (import.meta.env.DEV) {
            console.log('[WS] ✅ Connected to backend');
          }

          // Flush message queue
          while (messageQueue.current.length > 0) {
            const msg = messageQueue.current.shift();
            try {
              socket.send(JSON.stringify(msg));
            } catch (err) {
              logger.error('[WS] Failed to send queued message:', err);
            }
          }
        };

        socket.onmessage = (event) => {
          try {
            if (typeof Blob !== 'undefined' && event.data instanceof Blob) {
              return;
            }

            const message = JSON.parse(event.data);

            if (Number.isFinite(message.seq_id)) {
              const nextSeq = Number(message.seq_id);
              if (nextSeq > lastSeqRef.current) {
                lastSeqRef.current = nextSeq;
              }
              scheduleAck();
            }

            if (!message.type) {
              if (import.meta.env.DEV) {
                console.warn('[WS] Invalid message: missing type field', message);
              }
              return;
            }

            const messageData = message.data || {};
            if (
              typeof messageData.session_id === 'string' &&
              messageData.session_id.length > 0 &&
              !sessionIdRef.current
            ) {
              sessionIdRef.current = messageData.session_id;
            }

            // 'ready' / 'pong' are control messages — use 'ready' to promote to ONLINE early
            if (message.type === 'ready') {
              const readyData = message.data || {};
              if (typeof readyData.session_id === 'string' && readyData.session_id.length > 0) {
                sessionIdRef.current = readyData.session_id;
              }
              if (Number.isFinite(readyData.last_seq)) {
                lastSeqRef.current = Math.max(lastSeqRef.current, Number(readyData.last_seq));
              }

              if (initTimerRef.current) {
                clearTimeout(initTimerRef.current);
                initTimerRef.current = null;
              }
              setConnectionState(ConnectionState.ONLINE);
              scheduleAck();
              clearReconnectState();
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
            const ignoredTypes = ['chat.abort'];
            
            if (typeHandlers && typeHandlers.size > 0) {
              const data = message.data || message;
              typeHandlers.forEach((handler) => handler(data));
            } else if (import.meta.env.DEV && !ignoredTypes.includes(message.type)) {
              console.warn('[WS] Unknown message type:', message.type);
            }
          } catch (err) {
            logger.error('[WS] Failed to parse message:', err);
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

          logBackendOffline();
        };

        socket.onclose = (event) => {
          if (socket._instanceId !== instanceId) {
            return;
          }
          if (socket._mountId !== mountIdRef.current) {
            return;
          }

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

          const latestUrl = urlRef.current;
          if (!latestUrl || latestUrl !== socket._sourceUrl) {
            clearReconnectTimer();
            setConnectionState(ConnectionState.OFFLINE);
            return;
          }

          // 4401 = invalid/expired access token. Try one HTTP refresh, then reconnect.
          if (event.code === 4401) {
            clearReconnectTimer();
            if (authRefreshAttemptsRef.current >= 1) {
              clearBrowserAuthState();
              useAuthStore.getState().logout();
              setConnectionState(ConnectionState.OFFLINE);
              setReconnectError('Session expired. Please log in again.');
              return;
            }

            authRefreshAttemptsRef.current += 1;
            setConnectionState(ConnectionState.RECONNECTING);
            refreshAccessTokenSingleFlight()
              .then((data) => {
                useAuthStore.setState({ accessToken: data.access_token });
                isIntentionalCloseRef.current = false;
                connectRef.current(socket._sourceUrl);
              })
              .catch(() => {
                clearBrowserAuthState();
                useAuthStore.getState().logout();
                setConnectionState(ConnectionState.OFFLINE);
                setReconnectError('Session expired. Please log in again.');
              });
            return;
          }

          // 4403 = authorization failure — don't reconnect automatically
          if (event.code === 4403) {
            clearReconnectTimer();
            setConnectionState(ConnectionState.OFFLINE);
            setReconnectError('Session authorization failed. Please log in again.');
            return;
          }

          // 4404 = session not found (backend already gracefully falls back, but
          // handle it defensively here too). Clear resume state so the retry
          // connects fresh without injecting stale resume params.
          if (event.code === 4404) {
            if (import.meta.env.DEV) {
              console.warn('[WS] Session not found (4404) — clearing resume state before retry');
            }
            sessionIdRef.current = null;
            lastSeqRef.current = 0;
            lastAckedSeqRef.current = 0;
          }

          // Fast-fail detection: if the connection opened and then closed within 2s
          // while we had a stale session_id, the session has expired. Clear it so
          // the reconnect attempt goes in as a fresh connection (no resume=true).
          const openDuration = Date.now() - connectedAtRef.current;
          if (openDuration < 2000 && sessionIdRef.current && connectedAtRef.current > 0) {
            if (import.meta.env.DEV) {
              console.warn(
                `[WS] Fast-fail detected (closed after ${openDuration}ms with active session_id) — clearing resume state`
              );
            }
            sessionIdRef.current = null;
            lastSeqRef.current = 0;
            lastAckedSeqRef.current = 0;
          }

          // Normal close — don't reconnect
          if (event.code === 1000 || event.code === 1001) {
            clearReconnectTimer();
            clearReconnectState();
            setConnectionState(ConnectionState.OFFLINE);
            return;
          }

          // Abnormal close — schedule reconnect with exponential backoff
          scheduleReconnect(`Socket closed with code ${event.code}`, socket._sourceUrl);
        };
      } catch (err) {
        isConnectingRef.current = false;

        logBackendOffline();

        scheduleReconnect(err?.message || 'Failed to create WebSocket connection', currentUrl);
      }
    },
    [scheduleAck, clearReconnectState, clearReconnectTimer, scheduleReconnect, pauseReconnect, logBackendOffline]
  );

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // Reinitialize the socket lifecycle whenever URL changes.
  useEffect(() => {
    mountIdRef.current = Math.random();
    if (!url) {
      clearReconnectTimer();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConnectionState(ConnectionState.OFFLINE);
      return () => {
        isIntentionalCloseRef.current = true;
      };
    }

    connect(url);

    return () => {
      if (import.meta.env.DEV) {
        console.debug('[WS] Cleanup: marking intentional close');
      }

      isIntentionalCloseRef.current = true;
      isConnectingRef.current = false;
      reconnectPausedRef.current = false;

      // Wipe session/seq state on URL change so the next connection
      // never injects stale resume params into a different session's URL.
      sessionIdRef.current = null;
      lastSeqRef.current = 0;
      lastAckedSeqRef.current = 0;
      connectedAtRef.current = 0;
      authRefreshAttemptsRef.current = 0;

      cleanupTimers();

      if (wsRef.current) {
        const socket = wsRef.current;

        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close(1000);
        wsRef.current = null;
      }

      reconnectAttempts.current = 0;
      setReconnectError(null);
    };
  }, [url, connect, clearReconnectTimer, cleanupTimers]);

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
          logger.error('[WS] Failed to send message:', err);
          if (!isBinary) {
            messageQueue.current.push(message);
          }
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
        if (set.size === 0) {
          delete handlers.current[type];
        }
      }
    };
  }, []);

  /**
   * Manually disconnect. Prevents automatic reconnection.
   */
  const disconnect = useCallback(() => {
    isIntentionalCloseRef.current = true;
    reconnectPausedRef.current = false;

    cleanupTimers();

    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close(1000);
      wsRef.current = null;
    }

    setConnectionState(ConnectionState.OFFLINE);
    sessionIdRef.current = null;
    lastSeqRef.current = 0;
    lastAckedSeqRef.current = 0;
    reconnectAttempts.current = 0;
    authRefreshAttemptsRef.current = 0;
    setReconnectError(null);
  }, [cleanupTimers]);

  const reconnect = useCallback(() => {
    reconnectPausedRef.current = false;
    reconnectAttempts.current = 0;
    authRefreshAttemptsRef.current = 0;
    clearReconnectTimer();
    setReconnectError(null);
    setConnectionState(ConnectionState.RECONNECTING);
    isIntentionalCloseRef.current = false;
    connectRef.current();
  }, [clearReconnectTimer]);

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

export default useWSClient;

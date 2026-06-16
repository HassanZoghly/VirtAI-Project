import { useAuthStore } from '@/features/auth/store/authStore';
import { clearBrowserAuthState } from '@/features/auth/services/authStateCleanup';
import { refreshAccessTokenSingleFlight } from '@/features/auth/services/refreshService';
import { logger } from '@/shared/utils/logger';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ConnectionState,
  WS_CLOSE_TOKEN_EXPIRED,
  WS_CLOSE_UNAUTHORIZED,
  WS_CLOSE_SESSION_INVALID,
  WS_CLOSE_NORMAL,
  RECONNECT_PAUSE_MESSAGE
} from './wsConstants';
import { createReconnectPolicy } from './wsReconnectPolicy';
import {
  createSessionResumeState,
  buildResumeUrl,
  flushAckBatch,
  flushMessageQueue,
  pushToMessageQueue,
  resetSessionState
} from './wsSessionResume';
import { createEventRouter } from './wsEventRouter';

export { ConnectionState } from './wsConstants';

function useWSClient(url) {
  const [connectionState, setConnectionState] = useState(ConnectionState.OFFLINE);
  const [reconnectError, setReconnectError] = useState(null);
  const accessToken = useAuthStore((state) => state.accessToken);

  const isConnected = connectionState === ConnectionState.ONLINE;

  const eventRouterRef = useRef(createEventRouter());
  const sessionStateRef = useRef(createSessionResumeState());
  const reconnectPolicyRef = useRef(createReconnectPolicy());

  const reconnectTimeoutRef = useRef(null);
  const wsRef = useRef(null);
  const ackTimerRef = useRef(null);
  const isIntentionalCloseRef = useRef(false);
  const isConnectingRef = useRef(false);
  const lastErrorTimeRef = useRef(0);
  const mountIdRef = useRef(0);
  const initTimerRef = useRef(null);
  const connectRef = useRef(() => {});
  const accessTokenRef = useRef(accessToken);
  const urlRef = useRef(url);
  const connectedAtRef = useRef(0);
  const authRefreshAttemptsRef = useRef(0);

  useEffect(() => {
    if (accessToken !== accessTokenRef.current) {
      if (wsRef.current) {
        wsRef.current.close(WS_CLOSE_NORMAL, 'Token refreshed');
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
      !reconnectPolicyRef.current.isPaused &&
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
        console.info('[WS] 💡 Start backend: cd backend && python -m uvicorn app.main:app --reload');
      }
      lastErrorTimeRef.current = now;
    }
  }, []);

  const clearReconnectState = useCallback(() => {
    reconnectPolicyRef.current.reset();
    setReconnectError(null);
  }, []);

  const pauseReconnect = useCallback(() => {
    clearReconnectTimer();
    reconnectPolicyRef.current.pause();
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

      if (reconnectPolicyRef.current.isPaused) {
        return;
      }

      if (reconnectPolicyRef.current.shouldPause()) {
        if (import.meta.env.DEV) {
          console.error('[WS] Maximum reconnect attempts reached (5). Pausing retries.');
          if (reason) {
            console.warn('[WS] Last reconnect reason:', reason);
          }
        }
        pauseReconnect();
        return;
      }

      const delay = reconnectPolicyRef.current.nextDelay();

      if (import.meta.env.DEV) {
        console.debug(
          `[WS] Reconnecting in ${delay}ms (attempt ${reconnectPolicyRef.current.attempt}/5)`
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
    flushAckBatch(sessionStateRef.current, (payload) => wsRef.current.send(payload));
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

      if (reconnectPolicyRef.current.isPaused) {
        if (import.meta.env.DEV) {
          console.debug('[WS] Reconnect paused; waiting for manual retry');
        }
        return;
      }

      if (reconnectPolicyRef.current.shouldPause()) {
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

      if (isConnectingRef.current) {
        if (import.meta.env.DEV) {
          console.debug('[WS] Connection already in progress, skipping');
        }
        return;
      }

      isConnectingRef.current = true;
      const currentMountId = mountIdRef.current;
      const instanceId = Math.random().toString(36).substring(7);

      if (reconnectPolicyRef.current.attempt > 0) {
        setConnectionState(ConnectionState.RECONNECTING);
      }

      try {
        const socketUrl = buildResumeUrl(currentUrl, sessionStateRef.current);

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

          setConnectionState(ConnectionState.INITIALIZING);

          initTimerRef.current = setTimeout(() => {
            initTimerRef.current = null;
            setConnectionState((prev) =>
              prev === ConnectionState.INITIALIZING ? ConnectionState.ONLINE : prev
            );
          }, 800);

          reconnectPolicyRef.current.reset();
          authRefreshAttemptsRef.current = 0;

          if (import.meta.env.DEV) {
            console.log('[WS] ✅ Connected to backend');
          }

          flushMessageQueue(sessionStateRef.current, (payload) => socket.send(payload), logger);
        };

        socket.onmessage = (event) => {
          eventRouterRef.current.route(event, {
            onSeq: (seq) => {
              if (seq > sessionStateRef.current.lastSeq) {
                sessionStateRef.current.lastSeq = seq;
              }
              scheduleAck();
            },
            onSessionId: (id) => {
              if (!sessionStateRef.current.sessionId) {
                sessionStateRef.current.sessionId = id;
              }
            },
            onReady: (message) => {
              const readyData = message.data || {};
              if (typeof readyData.session_id === 'string' && readyData.session_id.length > 0) {
                sessionStateRef.current.sessionId = readyData.session_id;
              }
              if (Number.isFinite(readyData.last_seq)) {
                sessionStateRef.current.lastSeq = Math.max(
                  sessionStateRef.current.lastSeq,
                  Number(readyData.last_seq)
                );
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
            }
          });
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

          if (event.code === WS_CLOSE_TOKEN_EXPIRED) {
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
                if (isIntentionalCloseRef.current) return;
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

          if (event.code === WS_CLOSE_UNAUTHORIZED) {
            clearReconnectTimer();
            setConnectionState(ConnectionState.OFFLINE);
            setReconnectError('Session authorization failed. Please log in again.');
            return;
          }

          if (event.code === WS_CLOSE_SESSION_INVALID) {
            if (import.meta.env.DEV) {
              console.warn('[WS] Session not found (4404) — clearing resume state before retry');
            }
            resetSessionState(sessionStateRef.current);
          }

          const openDuration = Date.now() - connectedAtRef.current;
          if (openDuration < 2000 && sessionStateRef.current.sessionId && connectedAtRef.current > 0) {
            if (import.meta.env.DEV) {
              console.warn(
                `[WS] Fast-fail detected (closed after ${openDuration}ms with active session_id) — clearing resume state`
              );
            }
            resetSessionState(sessionStateRef.current);
          }

          if (event.code === WS_CLOSE_NORMAL || event.code === 1001) {
            clearReconnectTimer();
            clearReconnectState();
            setConnectionState(ConnectionState.OFFLINE);
            return;
          }

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
      reconnectPolicyRef.current.reset();

      resetSessionState(sessionStateRef.current);
      connectedAtRef.current = 0;
      authRefreshAttemptsRef.current = 0;

      cleanupTimers();

      if (wsRef.current) {
        const socket = wsRef.current;

        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close(WS_CLOSE_NORMAL);
        wsRef.current = null;
      }

      reconnectPolicyRef.current.reset();
      setReconnectError(null);
    };
  }, [url, connect, clearReconnectTimer, cleanupTimers]);

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
            pushToMessageQueue(sessionStateRef.current, message);
          }
        }
      } else if (!isBinary) {
        pushToMessageQueue(sessionStateRef.current, message);
      }
    },
    []
  );

  const onMessage = useCallback((type, handler) => {
    return eventRouterRef.current.onMessage(type, handler);
  }, []);

  const disconnect = useCallback(() => {
    isIntentionalCloseRef.current = true;
    reconnectPolicyRef.current.reset();

    cleanupTimers();

    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close(WS_CLOSE_NORMAL);
      wsRef.current = null;
    }

    setConnectionState(ConnectionState.OFFLINE);
    resetSessionState(sessionStateRef.current);
    reconnectPolicyRef.current.reset();
    authRefreshAttemptsRef.current = 0;
    setReconnectError(null);
  }, [cleanupTimers]);

  const reconnect = useCallback(() => {
    reconnectPolicyRef.current.reset();
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

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * WebSocket client hook with automatic reconnection and message queue
 *
 * Features:
 * - Automatic reconnection with exponential backoff (1s, 2s, 4s, 8s, 16s, 30s max)
 * - Message queue for offline messages (sent when reconnected)
 * - Message type validation in development mode
 * - Type-based message handler registration
 *
 * @param {string} url - WebSocket server URL
 * @returns {Object} - { isConnected, send, onMessage, disconnect }
 */
function useWSClient(url) {
  const [isConnected, setIsConnected] = useState(false);

  // Use refs to avoid stale closures
  const messageQueue = useRef([]);
  const reconnectAttempts = useRef(0);
  const handlers = useRef({});
  const reconnectTimeoutRef = useRef(null);
  const wsRef = useRef(null);
  const isIntentionalCloseRef = useRef(false); // Track intentional closes
  const isConnectingRef = useRef(false); // Prevent multiple simultaneous connections
  const lastErrorTimeRef = useRef(0); // Throttle error logging

  const connect = useCallback(() => {
    // Prevent multiple simultaneous connection attempts
    if (isConnectingRef.current) {
      if (import.meta.env.DEV) {
        console.debug('[WS] Connection already in progress, skipping');
      }
      return;
    }

    isConnectingRef.current = true;

    try {
      const socket = new WebSocket(url);
      wsRef.current = socket;
      isIntentionalCloseRef.current = false; // Reset intentional close flag

      socket.onopen = () => {
        isConnectingRef.current = false;
        setIsConnected(true);
        reconnectAttempts.current = 0;

        if (import.meta.env.DEV) {
          console.debug('[WS] Connected to', url);
        }

        // Flush message queue
        if (messageQueue.current.length > 0) {
          if (import.meta.env.DEV) {
            console.debug(`[WS] Flushing ${messageQueue.current.length} queued messages`);
          }
          while (messageQueue.current.length > 0) {
            const msg = messageQueue.current.shift();
            try {
              socket.send(JSON.stringify(msg));
            } catch (err) {
              console.error('[WS] Failed to send queued message:', err);
            }
          }
        }
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          // Validate message type
          if (!message.type) {
            if (import.meta.env.DEV) {
              console.warn('[WS] Invalid message: missing type field', message);
            }
            return;
          }

          // Silently ignore heartbeat and connection messages
          const ignorableTypes = ['ready', 'pong'];
          if (ignorableTypes.includes(message.type)) {
            if (import.meta.env.DEV) {
              console.debug(`[WS] Received ${message.type} message`);
            }
            return;
          }

          // Call registered handler for this message type
          const handler = handlers.current[message.type];
          if (handler) {
            handler(message.data || message);
          } else if (import.meta.env.DEV) {
            console.warn('[WS] Unknown message type:', message.type);
          }
        } catch (err) {
          console.error('[WS] Failed to parse message:', err);
        }
      };

      socket.onerror = (error) => {
        isConnectingRef.current = false;
        
        // Throttle error logging (max once per 5 seconds to prevent spam)
        const now = Date.now();
        const shouldLog = now - lastErrorTimeRef.current > 5000;
        
        // Only log errors if not intentionally closing and not in CONNECTING state during cleanup
        const isConnecting = socket.readyState === WebSocket.CONNECTING;
        const shouldSuppressError = isIntentionalCloseRef.current && isConnecting;
        
        if (!shouldSuppressError && shouldLog) {
          console.error('[WS] Connection error (backend may not be running). Retrying with backoff...');
          lastErrorTimeRef.current = now;
        } else if (import.meta.env.DEV && shouldSuppressError) {
          console.debug('[WS] Connection error during intentional close (suppressed)');
        }
      };

      socket.onclose = (event) => {
        isConnectingRef.current = false;
        setIsConnected(false);
        wsRef.current = null;

        // Don't reconnect if this was an intentional close
        if (isIntentionalCloseRef.current) {
          if (import.meta.env.DEV) {
            console.debug('[WS] Intentional close, not reconnecting');
          }
          return;
        }

        // Log close reason (throttled)
        const now = Date.now();
        if (import.meta.env.DEV && now - lastErrorTimeRef.current > 5000) {
          console.debug(`[WS] Disconnected (code: ${event.code}, reason: ${event.reason || 'none'}), reconnecting...`);
          lastErrorTimeRef.current = now;
        }

        // Exponential backoff reconnection
        // Delays: 1s, 2s, 4s, 8s, 16s, 30s (max)
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
        reconnectAttempts.current += 1;

        // Clear any existing reconnect timeout
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }

        // Schedule reconnection
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      };
    } catch (err) {
      isConnectingRef.current = false;
      
      // Throttle error logging
      const now = Date.now();
      if (now - lastErrorTimeRef.current > 5000) {
        console.error('[WS] Failed to create WebSocket (is backend running?):', err.message);
        lastErrorTimeRef.current = now;
      }

      // Retry connection with backoff
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
      reconnectAttempts.current += 1;

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, delay);
    }
  }, [url]);

  // Initialize connection on mount
  useEffect(() => {
    connect();

    // Cleanup on unmount
    return () => {
      isIntentionalCloseRef.current = true; // Mark as intentional close
      isConnectingRef.current = false; // Reset connecting flag

      // Clear reconnect timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      // Close WebSocket only if OPEN (avoid errors on CONNECTING state)
      if (wsRef.current) {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.close();
        }
        wsRef.current = null;
      }
    };
  }, [connect]);

  /**
   * Send a message through WebSocket
   * If disconnected, message is queued for later delivery
   *
   * @param {Object} message - Message object to send
   */
  const send = useCallback(
    (message) => {
      if (isConnected && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify(message));
        } catch (err) {
          console.error('[WS] Failed to send message:', err);
          // Queue message if send fails
          messageQueue.current.push(message);
        }
      } else {
        // Queue message for later
        messageQueue.current.push(message);
      }
    },
    [isConnected]
  );

  /**
   * Register a message handler for a specific message type
   *
   * @param {string} type - Message type to handle
   * @param {Function} handler - Handler function (receives message.data)
   */
  const onMessage = useCallback((type, handler) => {
    handlers.current[type] = handler;

    // Return cleanup function
    return () => {
      delete handlers.current[type];
    };
  }, []);

  /**
   * Manually disconnect WebSocket
   * Prevents automatic reconnection
   */
  const disconnect = useCallback(() => {
    isIntentionalCloseRef.current = true; // Mark as intentional

    // Clear reconnect timeout to prevent reconnection
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Close WebSocket only if OPEN
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setIsConnected(false);
  }, []);

  return {
    isConnected,
    send,
    onMessage,
    disconnect,
  };
}

export default useWSClient;

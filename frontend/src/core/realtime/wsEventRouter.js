import { logger } from '@/shared/utils/logger';

export function createEventRouter() {
  const handlers = {};

  return {
    onMessage(type, handler) {
      if (!handlers[type]) {
        handlers[type] = new Set();
      }
      handlers[type].add(handler);

      return () => {
        const set = handlers[type];
        if (set) {
          set.delete(handler);
          if (set.size === 0) {
            delete handlers[type];
          }
        }
      };
    },
    
    route(event, callbacks) {
      try {
        if (typeof Blob !== 'undefined' && event.data instanceof Blob) {
          return;
        }

        const message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;

        if (Number.isFinite(message.seq_id)) {
          callbacks.onSeq(Number(message.seq_id));
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
          messageData.session_id.length > 0
        ) {
          callbacks.onSessionId(messageData.session_id);
        }

        if (message.type === 'ready') {
          callbacks.onReady(message);
          return;
        }

        if (message.type === 'pong') {
          if (import.meta.env.DEV) {
            console.debug('[WS] Received pong');
          }
          return;
        }

        const typeHandlers = handlers[message.type];
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
    }
  };
}

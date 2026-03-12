import { useEffect, useRef } from 'react';

/**
 * Lightweight typed pub/sub event bus.
 *
 * Events:
 *   chat:message-sent    — { message_id, text }
 *   chat:response-received — { message_id, text }
 *   avatar:start-talking  — { audioUrl, mouthCues }
 *   avatar:stop-talking   — {}
 *   asr:final-result      — { text }
 *   session:created       — { sessionId }
 *   session:switched      — { sessionId }
 */

const listeners = new Map();

function on(event, handler) {
  if (!listeners.has(event)) {
    listeners.set(event, new Set());
  }
  listeners.get(event).add(handler);
  return () => listeners.get(event)?.delete(handler);
}

function emit(event, data) {
  const set = listeners.get(event);
  if (!set) {
    return;
  }
  set.forEach((handler) => handler(data));
}

function off(event, handler) {
  listeners.get(event)?.delete(handler);
}

export const eventBus = { on, emit, off };

export function useEventBus(event, handler) {
  const savedHandler = useRef(handler);

  useEffect(() => {
    savedHandler.current = handler;
  }, [handler]);

  useEffect(() => {
    const listener = (data) => savedHandler.current(data);
    return on(event, listener);
  }, [event]);
}

export default eventBus;

import { logger } from '@/shared/utils/logger';
import { useCallback, useRef } from 'react';
import type { EventRouterPayload, WSOutgoingMessage } from './types';
import { createEventRouter, EventRouter } from './wsEventRouter';
import { flushMessageQueue, pushToMessageQueue, SessionResumeState } from './wsSessionResume';

export function useWSMessageQueue() {
  const eventRouterRef = useRef<EventRouter>(createEventRouter());

  const send = useCallback(
    (
      message: WSOutgoingMessage,
      wsRef: React.MutableRefObject<WebSocket | null>,
      sessionStateRef: React.MutableRefObject<SessionResumeState>
    ) => {
      const isBinary =
        message instanceof ArrayBuffer || message instanceof Blob || ArrayBuffer.isView(message);

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(isBinary ? (message as ArrayBuffer | Blob | ArrayBufferView) : JSON.stringify(message));
        } catch (err: unknown) {
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

  const onMessage = useCallback((type: string, handler: (data: EventRouterPayload) => void) => {
    return eventRouterRef.current.onMessage(type, handler);
  }, []);

  const flushQueue = useCallback(
    (
      wsRef: React.MutableRefObject<WebSocket | null>,
      sessionStateRef: React.MutableRefObject<SessionResumeState>
    ) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      flushMessageQueue(sessionStateRef.current, (payload) => wsRef.current?.send(payload), logger);
    },
    []
  );

  return {
    eventRouterRef,
    send,
    onMessage,
    flushQueue,
  };
}

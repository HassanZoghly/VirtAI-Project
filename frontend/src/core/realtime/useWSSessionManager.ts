import { useCallback, useRef } from 'react';
import {
  createSessionResumeState,
  flushAckBatch,
  resetSessionState,
  SessionResumeState,
} from './wsSessionResume';

export function useWSSessionManager() {
  const sessionStateRef = useRef<SessionResumeState>(createSessionResumeState());
  const ackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushAck = useCallback((wsRef: React.MutableRefObject<WebSocket | null>) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }
    flushAckBatch(sessionStateRef.current, (payload) => wsRef.current?.send(payload));
  }, []);

  const scheduleAck = useCallback(
    (wsRef: React.MutableRefObject<WebSocket | null>) => {
      if (ackTimerRef.current) {
        return;
      }
      ackTimerRef.current = setTimeout(() => {
        ackTimerRef.current = null;
        flushAck(wsRef);
      }, 80);
    },
    [flushAck]
  );

  const resetSession = useCallback(() => {
    resetSessionState(sessionStateRef.current);
  }, []);

  const clearAckTimer = useCallback(() => {
    if (ackTimerRef.current) {
      clearTimeout(ackTimerRef.current);
      ackTimerRef.current = null;
    }
  }, []);

  return {
    sessionStateRef,
    ackTimerRef,
    flushAck,
    scheduleAck,
    resetSession,
    clearAckTimer,
  };
}

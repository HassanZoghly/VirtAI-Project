export function createSessionResumeState() {
  return {
    sessionId: null,
    lastSeq: 0,
    lastAckedSeq: 0,
    messageQueue: [],
  };
}

export function buildResumeUrl(url, state) {
  if (!state.sessionId || !url) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('resume', 'true');
    parsed.searchParams.set('session_id', state.sessionId);
    parsed.searchParams.set('last_seq', String(state.lastSeq));
    return parsed.toString();
  } catch {
    return url;
  }
}

export function flushAckBatch(state, sendFn) {
  if (state.lastSeq <= state.lastAckedSeq) return;
  const ackPayload = {
    type: 'ws.ack',
    data: {
      last_seq: state.lastSeq,
      session_id: state.sessionId,
    },
  };
  try {
    sendFn(JSON.stringify(ackPayload));
    state.lastAckedSeq = state.lastSeq;
  } catch (err) {
    if (import.meta.env.DEV) {
      console.debug('[WS] Failed to send ack payload:', err);
    }
  }
}

export function flushMessageQueue(state, sendFn, logger) {
  while (state.messageQueue.length > 0) {
    const msg = state.messageQueue.shift();
    try {
      sendFn(JSON.stringify(msg));
    } catch (err) {
      logger.error('[WS] Failed to send queued message:', err);
    }
  }
}

export function pushToMessageQueue(state, message, maxQueueSize = 100) {
  if (state.messageQueue.length >= maxQueueSize) {
    state.messageQueue.shift();
  }
  state.messageQueue.push(message);
}

export function resetSessionState(state) {
  state.sessionId = null;
  state.lastSeq = 0;
  state.lastAckedSeq = 0;
}

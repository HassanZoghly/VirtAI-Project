import { WS_BASE_DELAY_MS, WS_MAX_DELAY_MS, WS_MAX_RECONNECT_ATTEMPTS } from './wsConstants';

export function createReconnectPolicy({
  maxAttempts = WS_MAX_RECONNECT_ATTEMPTS,
  baseDelay = WS_BASE_DELAY_MS,
  maxDelay = WS_MAX_DELAY_MS,
} = {}) {
  let attempt = 0;
  let isPaused = false;

  return {
    nextDelay() {
      const delay = Math.min(baseDelay * 2 ** attempt, maxDelay) + Math.random() * 1000;
      attempt++;
      return delay;
    },
    shouldPause() {
      return attempt >= maxAttempts;
    },
    reset() {
      attempt = 0;
      isPaused = false;
    },
    pause() {
      isPaused = true;
    },
    increment() {
      attempt++;
    },
    get attempt() {
      return attempt;
    },
    get isPaused() {
      return isPaused;
    }
  };
}

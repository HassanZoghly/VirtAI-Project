/**
 * Abstract polling transport for monitoring long-running background tasks.
 *
 * @param {Function} fetchStatusFn - Function that returns a promise with the current status
 * @param {Function} onProgress - Callback for progress updates (status, pct, etc)
 * @param {Function} onComplete - Callback when the task is complete
 * @param {Function} onError - Callback when the task fails
 * @param {number} initialDelay - Initial delay before polling starts (ms)
 * @param {number} maxDelay - Maximum delay between polls (ms)
 * @returns {Function} Function to cancel the polling
 */
export function createPollingTransport({
  fetchStatusFn,
  onProgress,
  onComplete,
  onError,
  initialDelay = 1000,
  maxDelay = 5000,
}) {
  let timeoutId = null;
  let isCancelled = false;
  let currentDelay = initialDelay;

  const poll = async () => {
    if (isCancelled) {
      return;
    }

    try {
      const status = await fetchStatusFn();

      // Terminal states
      if (status.current_stage === 'COMPLETE') {
        onComplete(status);
        return;
      }
      if (status.current_stage === 'FAILED') {
        onError(new Error(status.error_message || 'Task failed'));
        return;
      }
      if (status.current_stage === 'CANCELLED') {
        onError(new Error('Task cancelled'));
        return;
      }

      // In progress
      onProgress(status);

      // Adaptive polling: increase delay if status hasn't changed much
      // For now, simple exponential backoff up to maxDelay
      currentDelay = Math.min(currentDelay * 1.5, maxDelay);

      if (!isCancelled) {
        timeoutId = setTimeout(poll, currentDelay);
      }
    } catch (error) {
      if (!isCancelled) {
        onError(error);
      }
    }
  };

  // Start polling immediately
  poll();

  // Return cancel function
  return () => {
    isCancelled = true;
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  };
}

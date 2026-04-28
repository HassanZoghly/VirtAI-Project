const STORAGE_KEY = 'virtai-sessions';
const START_NEW_CONVERSATION_KEY = 'virtai-start-new-conversation';
let startConversationFlagClearScheduled = false;

/**
 * Load sessions array from localStorage.
 * Returns null if nothing stored or data is corrupt.
 */
export function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Save sessions array to localStorage.
 * Silently swallows quota-exceeded errors.
 */
export function saveToStorage(sessions) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    /* quota exceeded — keep in-memory */
  }
}

/** Remove sessions from localStorage. */
export function clearStorage() {
  localStorage.removeItem(STORAGE_KEY);
}

export function markStartNewConversation() {
  localStorage.setItem(START_NEW_CONVERSATION_KEY, '1');
}

export function consumeStartNewConversationFlag() {
  const shouldStart = localStorage.getItem(START_NEW_CONVERSATION_KEY) === '1';
  if (shouldStart && !startConversationFlagClearScheduled) {
    startConversationFlagClearScheduled = true;
    queueMicrotask(() => {
      localStorage.removeItem(START_NEW_CONVERSATION_KEY);
      startConversationFlagClearScheduled = false;
    });
  }
  return shouldStart;
}

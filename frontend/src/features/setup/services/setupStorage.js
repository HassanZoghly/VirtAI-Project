const STORAGE_KEY = 'virtai-setup';

/**
 * Load setup configuration from localStorage.
 * Returns null if nothing stored or data is corrupt.
 */
export function loadSetup() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Save setup configuration to localStorage.
 * @param {{ avatarId: string, voiceId: string, movementEnabled?: boolean }} config
 */
export function saveSetup(config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...config, savedAt: Date.now() }));
  } catch {
    /* quota exceeded — keep in-memory */
  }
}

/** Remove setup configuration from localStorage. */
export function clearSetup() {
  localStorage.removeItem(STORAGE_KEY);
}

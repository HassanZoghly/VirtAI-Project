import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Type-safe localStorage hook with JSON serialization.
 * Syncs across tabs via the storage event.
 *
 * @param {string} key        - localStorage key
 * @param {*}      initialValue - default when key is absent or corrupt
 * @returns {[value, setValue, removeValue]}
 */
export function useLocalStorage(key, initialValue) {
  const initialValueRef = useRef(initialValue);

  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = localStorage.getItem(key);
      return item !== null ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = useCallback(
    (value) => {
      setStoredValue((prev) => {
        const next = typeof value === 'function' ? value(prev) : value;
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* quota exceeded — keep in-memory value */
        }
        return next;
      });
    },
    [key]
  );

  const removeValue = useCallback(() => {
    localStorage.removeItem(key);
    setStoredValue(initialValueRef.current);
  }, [key]);

  // Sync across tabs
  useEffect(() => {
    const handleStorage = (e) => {
      if (e.key !== key) return;
      try {
        setStoredValue(e.newValue !== null ? JSON.parse(e.newValue) : initialValueRef.current);
      } catch {
        setStoredValue(initialValueRef.current);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [key]);

  return [storedValue, setValue, removeValue];
}

export default useLocalStorage;

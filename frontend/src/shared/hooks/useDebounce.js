import { useState, useEffect, useRef } from 'react';

/**
 * Generic debounce hook.
 * Returns the debounced version of `value` that only updates
 * after `delay` ms of inactivity.
 *
 * @param {*}      value - value to debounce
 * @param {number} delay - debounce delay in ms (default 300)
 * @returns {*} debounced value
 */
export function useDebounce(value, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  const timerRef = useRef(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timerRef.current);
  }, [value, delay]);

  return debouncedValue;
}

export default useDebounce;

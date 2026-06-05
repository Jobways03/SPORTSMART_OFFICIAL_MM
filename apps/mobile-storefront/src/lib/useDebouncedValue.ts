import {useEffect, useState} from 'react';

/**
 * Returns `value` after `delayMs` of stillness. Used by the search input
 * so we don't fire a TanStack Query per keystroke — only once the user
 * pauses typing.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

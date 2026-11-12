import { useEffect, useState } from "react";

const DEFAULT_DELAY_MS = 250;

/** `value`, but only after it has stopped changing for `delayMs` (search boxes). */
export function useDebouncedValue<T>(
  value: T,
  delayMs: number = DEFAULT_DELAY_MS
): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

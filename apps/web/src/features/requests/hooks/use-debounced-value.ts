import { useEffect, useState } from "react";

const DEFAULT_DELAY_MS = 250;

/** `value`, but only after it stopped changing for `delayMs` (search boxes). */
export function useDebouncedValue<T>(value: T, delayMs = DEFAULT_DELAY_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

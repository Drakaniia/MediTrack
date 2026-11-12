import { useCallback, useSyncExternalStore } from "react";

/** Tailwind's `lg` breakpoint. */
export const LG_QUERY = "(min-width: 64rem)";

/** Live result of a CSS media query (`false` on the server and where `matchMedia` is missing). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== "function") {
        return () => undefined;
      }
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query]
  );
  const getSnapshot = useCallback(
    () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia(query).matches,
    [query]
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

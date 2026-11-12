import { useCallback, useState } from "react";

export const SIDEBAR_COLLAPSED_KEY = "meditract:sidebar-collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

/** The desktop sidebar's collapsed (icon-only) state, remembered across visits. */
export function useSidebarCollapsed(): {
  collapsed: boolean;
  toggle: () => void;
} {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);

  const toggle = useCallback(() => {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        // Private mode / quota: remembered for this session only.
      }
      return next;
    });
  }, []);

  return { collapsed, toggle };
}

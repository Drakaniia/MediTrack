import {
  createContext,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/**
 * UI density preference. "comfortable" is the default; "compact" tightens rows
 * for data-heavy screens. Persisted in localStorage (`meditract:density`) and
 * mirrored on `<html data-density>` — `public/theme-init.js` applies it before
 * first paint, and the `compact:` Tailwind variant (`index.css`) keys off it.
 */

export type Density = "comfortable" | "compact";

export const DENSITY_STORAGE_KEY = "meditract:density";
export const DEFAULT_DENSITY: Density = "comfortable";

interface DensityContextValue {
  density: Density;
  setDensity: (density: Density) => void;
}

const DensityContext = createContext<DensityContextValue | null>(null);

const FALLBACK_VALUE: DensityContextValue = {
  density: DEFAULT_DENSITY,
  setDensity: () => undefined,
};

export function isDensity(value: unknown): value is Density {
  return value === "comfortable" || value === "compact";
}

function readStoredDensity(): Density {
  try {
    const stored = localStorage.getItem(DENSITY_STORAGE_KEY);
    return isDensity(stored) ? stored : DEFAULT_DENSITY;
  } catch {
    return DEFAULT_DENSITY;
  }
}

function storeDensity(density: Density): void {
  try {
    localStorage.setItem(DENSITY_STORAGE_KEY, density);
  } catch {
    // Private mode / quota: the preference lasts for this session only.
  }
}

export function DensityProvider({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const [density, setDensityState] = useState<Density>(readStoredDensity);

  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  const setDensity = useCallback((next: Density) => {
    setDensityState(next);
    storeDensity(next);
  }, []);

  const value = useMemo(() => ({ density, setDensity }), [density, setDensity]);

  return (
    <DensityContext.Provider value={value}>{children}</DensityContext.Provider>
  );
}

/** The current density and its setter. Outside a provider it reads as "comfortable" and ignores writes. */
export function useDensity(): DensityContextValue {
  return useContext(DensityContext) ?? FALLBACK_VALUE;
}

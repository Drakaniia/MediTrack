// Runs before first paint (loaded from <head>, see index.html). Mirrors
// next-themes (storageKey `vite-ui-theme`, default theme `dark`) and the density
// preference (`meditract:density`), so neither flashes on load.
const THEME_STORAGE_KEY = "vite-ui-theme";
const DENSITY_STORAGE_KEY = "meditract:density";
const WRAPPING_QUOTES = /^"|"$/g;

(() => {
  try {
    const root = document.documentElement;

    // next-themes stores a plain string, but tolerate a JSON-quoted value too.
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    const theme = stored ? stored.replace(WRAPPING_QUOTES, "") : null;

    // defaultTheme is "dark": anything that is not an explicit "light" (or a
    // "system" preference for light) resolves to dark, including no value at all.
    const isDark =
      theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
        : theme !== "light";
    root.classList.toggle("dark", isDark);
    root.style.colorScheme = isDark ? "dark" : "light";

    const density = localStorage.getItem(DENSITY_STORAGE_KEY);
    if (density === "compact" || density === "comfortable") {
      root.dataset.density = density;
    }
  } catch {
    // Storage can throw in private mode or sandboxed frames. The app then
    // falls back to its defaults once React mounts.
  }
})();

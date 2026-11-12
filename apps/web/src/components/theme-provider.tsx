import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactElement, ReactNode } from "react";

/** next-themes key, shared with `public/theme-init.js` (which sets the class before first paint). */
export const THEME_STORAGE_KEY = "vite-ui-theme";

/** Dark by default (the clinic app is used in dim rooms); `.dark` on `<html>`. */
export function ThemeProvider({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      disableTransitionOnChange
      enableSystem
      storageKey={THEME_STORAGE_KEY}
    >
      {children}
    </NextThemesProvider>
  );
}

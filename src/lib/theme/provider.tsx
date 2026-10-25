"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { THEME_COOKIE, themeScheme, type ThemeId } from "./themes";

interface ThemeContextValue {
  theme: ThemeId;
  /** The scheme actually in effect ("system" resolved through the media query). */
  scheme: "light" | "dark";
  setTheme: (t: ThemeId) => void;
  /** Temporarily shows a theme without saving it; pass null to go back to the saved one. */
  previewTheme: (t: ThemeId | null) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeSystemScheme(onChange: () => void) {
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function ThemeProvider({ initialTheme, children }: { initialTheme: ThemeId; children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(initialTheme);
  const [preview, setPreview] = useState<ThemeId | null>(null);
  const systemDark = useSyncExternalStore(subscribeSystemScheme, () => window.matchMedia(DARK_QUERY).matches, () => false);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** Applies a theme to <html> with a short, smooth color transition. */
  const apply = useCallback((t: ThemeId) => {
    const root = document.documentElement;
    if (root.dataset.theme === t) return;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      root.classList.add("theme-transition");
      clearTimeout(transitionTimer.current);
      transitionTimer.current = setTimeout(() => root.classList.remove("theme-transition"), 400);
    }
    root.dataset.theme = t;
  }, []);

  const setTheme = useCallback(
    (t: ThemeId) => {
      // The server reads this cookie to render the right theme on first paint (no flash).
      document.cookie = `${THEME_COOKIE}=${t}; path=/; max-age=31536000; samesite=lax`;
      apply(t);
      setPreview(null);
      setThemeState(t);
    },
    [apply],
  );

  const previewTheme = useCallback(
    (t: ThemeId | null) => {
      setPreview(t);
      apply(t ?? theme);
    },
    [apply, theme],
  );

  const active = preview ?? theme;
  const scheme = useMemo(() => {
    const s = themeScheme(active);
    return s === "system" ? (systemDark ? "dark" : "light") : s;
  }, [active, systemDark]);

  // Keep the mobile browser chrome in step with the page background.
  useEffect(() => {
    const id = setTimeout(() => {
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--background").trim();
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
    }, 50);
    return () => clearTimeout(id);
  }, [active, scheme]);

  const value = useMemo(() => ({ theme, scheme, setTheme, previewTheme }), [theme, scheme, setTheme, previewTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}

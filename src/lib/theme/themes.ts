/**
 * Theme catalog. `scheme` drives native controls and toasts; the colors
 * themselves live in src/app/themes.css. Order = order in the theme gallery.
 */
export const THEMES = [
  { id: "system", scheme: "system" },
  { id: "light", scheme: "light" },
  { id: "paper", scheme: "light" },
  { id: "ocean", scheme: "light" },
  { id: "emerald", scheme: "light" },
  { id: "arctic", scheme: "light" },
  { id: "lavender", scheme: "light" },
  { id: "rose", scheme: "light" },
  { id: "sunset", scheme: "light" },
  { id: "sand", scheme: "light" },
  { id: "slate", scheme: "light" },
  { id: "midnight", scheme: "dark" },
  { id: "graphite", scheme: "dark" },
  { id: "nordic", scheme: "dark" },
  { id: "purple", scheme: "dark" },
  { id: "wine", scheme: "dark" },
  { id: "mocha", scheme: "dark" },
  { id: "forest", scheme: "dark" },
  { id: "amoled", scheme: "dark" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
export const DEFAULT_THEME: ThemeId = "system";
export const THEME_COOKIE = "theme";

export function isTheme(v: unknown): v is ThemeId {
  return typeof v === "string" && THEMES.some((t) => t.id === v);
}

export function themeScheme(id: ThemeId): "light" | "dark" | "system" {
  return THEMES.find((t) => t.id === id)?.scheme ?? "system";
}

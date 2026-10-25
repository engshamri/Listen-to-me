export const LOCALES = ["en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "locale";

export const LOCALE_DIR: Record<Locale, "ltr" | "rtl"> = { en: "ltr", ar: "rtl" };

/** Endonyms: each language is always shown in its own name. */
export const LOCALE_LABEL: Record<Locale, string> = { en: "English", ar: "العربية" };

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

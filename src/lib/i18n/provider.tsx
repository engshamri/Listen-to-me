"use client";

import { DirectionProvider } from "@radix-ui/react-direction";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { LOCALE_COOKIE, LOCALE_DIR, type Locale } from "./config";
import { createFormatters, createTranslator, type Formatters, type Translator } from "./translate";

interface I18nContextValue {
  locale: Locale;
  dir: "ltr" | "rtl";
  t: Translator;
  fmt: Formatters;
  setLocale: (l: Locale) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((l: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = l;
    document.documentElement.dir = LOCALE_DIR[l];
    document.title = createTranslator(l)("app.metaTitle");
    setLocaleState(l);
  }, []);

  const value = useMemo<I18nContextValue>(() => {
    const t = createTranslator(locale);
    return { locale, dir: LOCALE_DIR[locale], t, fmt: createFormatters(locale, t), setLocale };
  }, [locale, setLocale]);

  return (
    <I18nContext.Provider value={value}>
      {/* Radix components ignore <html dir>; they read direction from this provider. */}
      <DirectionProvider dir={value.dir}>{children}</DirectionProvider>
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}

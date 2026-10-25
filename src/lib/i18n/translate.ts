import type { Locale } from "./config";
import ar from "./messages/ar";
import en, { type Messages } from "./messages/en";
import { isPlural, type MessageKey, type Widen } from "./types";

export const MESSAGES: Record<Locale, Widen<Messages>> = { en, ar };

export type TKey = MessageKey<Messages>;
export type TParams = Record<string, string | number>;
export type Translator = (key: TKey, params?: TParams) => string;

/**
 * Numbers use Western digits in both interfaces so they match the Latin
 * labels around them (MP3, 1.5×, Ctrl+Enter) and render identically on the
 * server and in every browser.
 */
export function numberLocale(locale: Locale): string {
  return locale === "ar" ? "ar-u-nu-latn" : "en-US";
}

function lookup(locale: Locale, key: string): unknown {
  let node: unknown = MESSAGES[locale];
  for (const part of key.split(".")) {
    if (node && typeof node === "object") node = (node as Record<string, unknown>)[part];
    else return undefined;
  }
  return node;
}

export function createTranslator(locale: Locale): Translator {
  const rules = new Intl.PluralRules(locale);
  const nf = new Intl.NumberFormat(numberLocale(locale));
  return (key, params) => {
    let entry = lookup(locale, key) ?? lookup("en", key);
    if (isPlural(entry)) {
      const count = Number(params?.count ?? 0);
      const form = rules.select(count) as keyof typeof entry;
      entry = entry[form] ?? entry.other;
    }
    if (typeof entry !== "string") return key;
    if (!params) return entry;
    return entry.replace(/\{(\w+)\}/g, (m, name: string) => {
      const v = params[name];
      if (v === undefined) return m;
      return typeof v === "number" ? nf.format(v) : v;
    });
  };
}

export interface Formatters {
  number: (n: number, opts?: Intl.NumberFormatOptions) => string;
  bytes: (n: number) => string;
  /** "2 min 5 s" */
  duration: (seconds: number) => string;
  /** "2:05" */
  clock: (seconds: number) => string;
  time: (d: Date) => string;
}

export function createFormatters(locale: Locale, t: Translator): Formatters {
  const nl = numberLocale(locale);
  const number = (n: number, opts?: Intl.NumberFormatOptions) => new Intl.NumberFormat(nl, opts).format(n);
  return {
    number,
    bytes: (n) =>
      n < 1024 * 1024
        ? t("units.kb", { n: number(Math.max(1, Math.round(n / 1024))) })
        : t("units.mb", { n: number(n / 1024 / 1024, { maximumFractionDigits: 1 }) }),
    duration: (sec) => {
      const s = Math.max(0, Math.round(sec));
      if (s < 60) return t("units.seconds", { s: number(s) });
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      if (h > 0) return t("units.hours", { h: number(h), m: number(m) });
      const rest = s % 60;
      return rest ? t("units.minutes", { m: number(m), s: number(rest) }) : t("units.minutesOnly", { m: number(m) });
    },
    clock: (sec) => {
      // Nearest second, as browsers' audio controls show it (17.6 s → 0:18).
      const s = Math.max(0, Math.round(sec));
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const pad = (x: number) => String(x).padStart(2, "0");
      return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
    },
    time: (d) => new Intl.DateTimeFormat(nl, { hour: "numeric", minute: "2-digit" }).format(d),
  };
}

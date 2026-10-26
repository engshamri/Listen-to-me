import { ARABIC_REGIONS, type ArabicRegion, type LocalizedName, type Voice } from "./catalog";
import type { Locale } from "@/lib/i18n/config";

/**
 * Top level of the voice browser. Categories group *languages* (a voice is
 * placed by the language it speaks, never by guessing), so Spanish voices
 * from Mexico appear under European languages and French voices from Canada
 * under European languages too, each in its own country card.
 */
export const LANGUAGE_CATEGORIES = ["arabic", "english", "european", "asian", "african", "other"] as const;
export type LanguageCategory = (typeof LANGUAGE_CATEGORIES)[number];

const CATEGORY_OF_LANG: Record<string, LanguageCategory> = {
  ar: "arabic",
  en: "english",
  ...Object.fromEntries(
    ["bg", "bs", "ca", "cs", "cy", "da", "de", "el", "es", "et", "fi", "fr", "ga", "gl", "hr", "hu", "is", "it", "lt", "lv", "mk", "mt", "nb", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sq", "sr", "sv", "uk"].map((l) => [l, "european" as const]),
  ),
  ...Object.fromEntries(
    ["az", "bn", "fa", "fil", "gu", "he", "hi", "id", "ja", "jv", "ka", "kk", "km", "kn", "ko", "lo", "ml", "mn", "mr", "ms", "my", "ne", "ps", "si", "su", "ta", "te", "th", "tr", "ur", "uz", "vi", "zh"].map((l) => [l, "asian" as const]),
  ),
  ...Object.fromEntries(["af", "am", "so", "sw", "zu"].map((l) => [l, "african" as const])),
};

export function categoryOf(v: Pick<Voice, "lang">): LanguageCategory {
  return CATEGORY_OF_LANG[v.lang] ?? "other";
}

export interface CountryEntry {
  code: string;
  name: LocalizedName;
  voices: Voice[];
  /** Distinct languages spoken by this country's voices in the category. */
  languages: LocalizedName[];
  region: ArabicRegion | null;
}

export function countriesIn(category: LanguageCategory, voices: Voice[], locale: Locale): CountryEntry[] {
  const map = new Map<string, CountryEntry>();
  for (const v of voices) {
    if (categoryOf(v) !== category || !v.country || !v.countryName) continue;
    let entry = map.get(v.country);
    if (!entry) map.set(v.country, (entry = { code: v.country, name: v.countryName, voices: [], languages: [], region: v.region }));
    entry.voices.push(v);
    if (!entry.languages.some((l) => l.en === v.languageName.en)) entry.languages.push(v.languageName);
  }
  const collator = new Intl.Collator(locale);
  return [...map.values()].sort((a, b) => collator.compare(a.name[locale], b.name[locale]));
}

/** Arabic countries grouped by accent region, in a fixed, familiar order. */
export function groupByRegion(countries: CountryEntry[]): { region: ArabicRegion; countries: CountryEntry[] }[] {
  return ARABIC_REGIONS.map((region) => ({ region, countries: countries.filter((c) => c.region === region) })).filter((g) => g.countries.length > 0);
}

export interface CategorySummary {
  id: LanguageCategory;
  countries: number;
  voices: number;
  languages: number;
  /** A few country codes to show as a flag preview. */
  sampleFlags: string[];
}

const PREVIEW_FLAGS: Record<LanguageCategory, string[]> = {
  arabic: ["SA", "IQ", "EG", "MA"],
  english: ["US", "GB", "AU", "IN"],
  european: ["FR", "DE", "ES", "IT"],
  asian: ["CN", "JP", "IN", "KR"],
  african: ["KE", "ZA", "ET", "SO"],
  other: ["CA"],
};

export function summarizeCategories(voices: Voice[]): CategorySummary[] {
  return LANGUAGE_CATEGORIES.map((id) => {
    const inCat = voices.filter((v) => categoryOf(v) === id);
    const countries = new Set(inCat.map((v) => v.country).filter(Boolean));
    return {
      id,
      countries: countries.size,
      voices: inCat.length,
      languages: new Set(inCat.map((v) => v.lang)).size,
      sampleFlags: PREVIEW_FLAGS[id].filter((c) => countries.has(c)),
    };
  }).filter((c) => c.voices > 0);
}

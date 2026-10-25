import catalog from "@/data/voice-catalog.json";
import { matchesQuery, normalizeForSearch } from "@/lib/text/search";
import type { Locale } from "@/lib/i18n/config";

export type Gender = "Female" | "Male";

export interface LocalizedName {
  en: string;
  ar: string;
}

export interface Voice {
  id: string;
  provider: "edge";
  locale: string;
  lang: string;
  country: string;
  gender: Gender;
  name: string;
  nameAr: string;
  languageName: LocalizedName;
  countryName: LocalizedName | null;
  variant: LocalizedName | null;
  region: ArabicRegion | null;
  multilingual: boolean;
  personalities: string[];
  categories: string[];
  available: boolean;
}

export const ARABIC_REGIONS = ["gulf", "levant", "iraq", "egypt", "maghreb", "yemen"] as const;
export type ArabicRegion = (typeof ARABIC_REGIONS)[number];

export const VOICES = (catalog as Voice[]).filter((v) => v.available);
const BY_ID = new Map(VOICES.map((v) => [v.id, v]));

export const DEFAULT_VOICE_ID = "en-US-AvaMultilingualNeural";

export function getVoice(id: string | null | undefined): Voice | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export function isKnownVoice(id: unknown): id is string {
  return typeof id === "string" && BY_ID.has(id);
}

export function voiceName(v: Voice, locale: Locale): string {
  return locale === "ar" ? v.nameAr : v.name;
}

/** "Arabic · Iraq" / "Chinese · Cantonese" */
export function voiceSubtitle(v: Voice, locale: Locale): string {
  const parts = [v.languageName[locale]];
  if (v.variant) parts.push(v.variant[locale]);
  else if (v.countryName) parts.push(v.countryName[locale]);
  return parts.join(" · ");
}

/** Demonyms people use when searching Arabic voices ("Iraqi", "عراقي"). */
const ARABIC_DEMONYMS: Record<string, [string, string]> = {
  IQ: ["Iraqi", "عراقي"], EG: ["Egyptian", "مصري"], SA: ["Saudi", "سعودي"], AE: ["Emirati", "إماراتي"],
  KW: ["Kuwaiti", "كويتي"], QA: ["Qatari", "قطري"], BH: ["Bahraini", "بحريني"], OM: ["Omani", "عماني"],
  SY: ["Syrian", "سوري"], LB: ["Lebanese", "لبناني"], JO: ["Jordanian", "أردني"], PS: ["Palestinian", "فلسطيني"],
  MA: ["Moroccan", "مغربي"], DZ: ["Algerian", "جزائري"], TN: ["Tunisian", "تونسي"], LY: ["Libyan", "ليبي"],
  YE: ["Yemeni", "يمني"], SD: ["Sudanese", "سوداني"],
};
const REGION_WORDS: Record<ArabicRegion, string> = {
  gulf: "gulf khaleeji خليج خليجي",
  levant: "levant levantine shami شام شامي",
  iraq: "iraq عراق",
  egypt: "egypt مصر",
  maghreb: "maghreb maghrebi north africa مغرب مغاربي شمال افريقيا",
  yemen: "yemen يمن",
};
const GENDER_WORDS: Record<Gender, string> = {
  Female: "female woman women feminine أنثى انثى نسائي امرأة بنت",
  Male: "male man men masculine ذكر رجالي رجل ولد",
};

const HAYSTACK = new Map(
  VOICES.map((v) => {
    const words = [
      v.id, v.name, v.nameAr, v.locale,
      v.languageName.en, v.languageName.ar,
      v.countryName?.en, v.countryName?.ar,
      v.variant?.en, v.variant?.ar,
      v.region ? REGION_WORDS[v.region] : "",
      ARABIC_DEMONYMS[v.country] && v.lang === "ar" ? ARABIC_DEMONYMS[v.country].join(" ") : "",
      GENDER_WORDS[v.gender],
      v.multilingual ? "multilingual متعدد اللغات" : "",
      ...v.personalities,
    ];
    return [v.id, normalizeForSearch(words.filter(Boolean).join(" "))];
  }),
);

export interface VoiceFilters {
  query: string;
  lang: string | null;
  country: string | null;
  region: ArabicRegion | null;
  gender: Gender | null;
  personality: string | null;
  multilingualOnly: boolean;
}

export const EMPTY_FILTERS: VoiceFilters = {
  query: "",
  lang: null,
  country: null,
  region: null,
  gender: null,
  personality: null,
  multilingualOnly: false,
};

/** Search spans every voice unless a filter has been chosen explicitly. */
export function filterVoices(f: VoiceFilters): Voice[] {
  return VOICES.filter(
    (v) =>
      (!f.lang || v.lang === f.lang) &&
      (!f.country || v.country === f.country) &&
      (!f.region || v.region === f.region) &&
      (!f.gender || v.gender === f.gender) &&
      (!f.personality || v.personalities.includes(f.personality)) &&
      (!f.multilingualOnly || v.multilingual) &&
      matchesQuery(HAYSTACK.get(v.id)!, f.query),
  );
}

export interface VoiceGroup {
  key: string;
  label: string;
  voices: Voice[];
}

/**
 * Groups voices by language, or by country when a single language is shown.
 * Arabic and the interface language sort first; the rest alphabetically.
 */
export function groupVoices(voices: Voice[], locale: Locale, singleLanguage: boolean): VoiceGroup[] {
  const groups = new Map<string, VoiceGroup>();
  for (const v of voices) {
    const key = singleLanguage ? v.locale : v.lang;
    const label = singleLanguage
      ? (v.variant?.[locale] ?? v.countryName?.[locale] ?? v.locale)
      : v.languageName[locale];
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, label, voices: [] }));
    g.voices.push(v);
  }
  const collator = new Intl.Collator(locale);
  const priority = (k: string) => (k.startsWith("ar") ? 0 : k.startsWith(locale === "ar" ? "ar" : "en") ? 1 : 2);
  const list = [...groups.values()].sort((a, b) => priority(a.key) - priority(b.key) || collator.compare(a.label, b.label));
  for (const g of list) {
    g.voices.sort((a, b) => Number(b.multilingual) - Number(a.multilingual) || a.gender.localeCompare(b.gender) || collator.compare(voiceName(a, locale), voiceName(b, locale)));
  }
  return list;
}

export interface LanguageOption {
  code: string;
  name: LocalizedName;
  count: number;
}

export const VOICE_LANGUAGES: LanguageOption[] = (() => {
  const map = new Map<string, LanguageOption>();
  for (const v of VOICES) {
    const o = map.get(v.lang);
    if (o) o.count++;
    else map.set(v.lang, { code: v.lang, name: v.languageName, count: 1 });
  }
  return [...map.values()];
})();

export const PERSONALITIES: string[] = [...new Set(VOICES.flatMap((v) => v.personalities))].sort();

/** Picks a sensible first-visit voice from the browser's language preferences. */
export function suggestVoiceId(languages: readonly string[]): string {
  for (const tag of languages) {
    const lower = tag.toLowerCase();
    const base = lower.split("-")[0];
    if (base === "en") break; // English speakers get the multilingual default
    const exact = VOICES.find((v) => v.locale.toLowerCase() === lower && !v.multilingual);
    if (exact) return exact.id;
    const byLang = VOICES.find((v) => v.lang === base);
    if (byLang) return byLang.id;
  }
  return getVoice(DEFAULT_VOICE_ID) ? DEFAULT_VOICE_ID : VOICES[0].id;
}

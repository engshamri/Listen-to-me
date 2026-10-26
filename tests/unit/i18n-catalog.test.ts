import { existsSync } from "node:fs";
import catalog from "@/data/voice-catalog.json";
import quality from "@/data/voice-quality.json";
import rawVoices from "@/data/voices.json";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ar from "@/lib/i18n/messages/ar";
import en from "@/lib/i18n/messages/en";
import { createFormatters, createTranslator } from "@/lib/i18n/translate";
import { isPlural } from "@/lib/i18n/types";
import { backupLanguageFor } from "@/lib/voices/fallback";
import { PREVIEW_SAMPLES } from "@/lib/voices/samples";
import { VOICES, VOICE_LANGUAGES, filterVoices, EMPTY_FILTERS, groupVoices, suggestVoiceId, getVoice, isKnownVoice, DEFAULT_VOICE_ID, PERSONALITIES, type Voice } from "@/lib/voices/catalog";

function leaves(obj: unknown, prefix = ""): string[] {
  if (typeof obj === "string" || isPlural(obj)) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

describe("i18n", () => {
  it("Arabic and English dictionaries have exactly the same keys", () => {
    expect(leaves(ar).sort()).toEqual(leaves(en).sort());
  });

  it("no translation is empty and placeholders match", () => {
    const enT = leaves(en);
    for (const key of enT) {
      const get = (o: unknown) => key.split(".").reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], o);
      const e = get(en);
      const a = get(ar);
      const ph = (v: unknown) => [...JSON.stringify(v).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((n) => n !== "count").sort();
      expect(JSON.stringify(a).length, key).toBeGreaterThan(2);
      expect(new Set(ph(a)), key).toEqual(new Set(ph(e)));
    }
  });

  it("uses Arabic plural forms", () => {
    const t = createTranslator("ar");
    expect(t("voices.count", { count: 0 })).toBe("لا توجد أصوات");
    expect(t("voices.count", { count: 1 })).toBe("صوت واحد");
    expect(t("voices.count", { count: 2 })).toBe("صوتان");
    expect(t("voices.count", { count: 5 })).toBe("5 أصوات");
    expect(t("voices.count", { count: 32 })).toBe("32 صوتاً");
    expect(t("voices.count", { count: 100 })).toBe("100 صوت");
  });

  it("uses English plural forms and interpolation", () => {
    const t = createTranslator("en");
    expect(t("editor.words", { count: 1 })).toBe("1 word");
    expect(t("editor.words", { count: 1234 })).toBe("1,234 words");
    expect(t("generate.part", { done: 3, total: 12 })).toBe("Part 3 of 12");
  });

  it("formats numbers with Western digits in both languages", () => {
    const fmt = createFormatters("ar", createTranslator("ar"));
    expect(fmt.number(1234)).toMatch(/1.?234/);
    expect(fmt.clock(125)).toBe("2:05");
    // Matches the browser's audio controls, which round to the nearest second.
    expect(fmt.clock(17.6)).toBe("0:18");
    expect(fmt.clock(17.4)).toBe("0:17");
    expect(fmt.duration(125)).toBe("2 د 5 ث");
    expect(createFormatters("en", createTranslator("en")).bytes(1536 * 1024)).toBe("1.5 MB");
  });
});

describe("voice catalog", () => {
  it("has the provider catalog minus the voices the audit disabled and the duplicates of multilingual voices, plus Google Arabic", () => {
    const disabled = Object.entries(quality.voices as Record<string, { status?: string }>)
      .filter(([, q]) => q.status === "disabled")
      .map(([id]) => id);
    const duplicates = (catalog as Voice[]).filter((v) => v.duplicateOf);
    expect(duplicates.map((v) => v.id).sort()).toEqual(["en-US-AndrewNeural", "en-US-AvaNeural", "en-US-BrianNeural", "en-US-EmmaNeural"]);
    // Plus the second source: Google's Arabic voice.
    const google = VOICES.filter((v) => v.provider === "google");
    expect(google.map((v) => v.id)).toEqual(["google-ar"]);
    expect(google[0]).toMatchObject({ lang: "ar", country: "", name: "Google", nameAr: "جوجل" });
    expect(VOICES.length).toBe(rawVoices.length - disabled.length - duplicates.length + google.length);
    for (const id of disabled) expect(VOICES.some((v) => v.id === id), id).toBe(false);
    for (const d of duplicates) {
      // Hidden, replaced by an offered multilingual voice with the same name and language.
      expect(VOICES.some((v) => v.id === d.id), d.id).toBe(false);
      const twin = getVoice(d.id)!;
      expect(twin.id).toBe(d.duplicateOf);
      expect(twin.multilingual && twin.name === d.name && twin.locale === d.locale, d.id).toBe(true);
      expect(isKnownVoice(d.id)).toBe(true);
    }
    // No two offered voices look the same in a list.
    const seen = new Set<string>();
    for (const v of VOICES) {
      const key = `${v.locale}|${v.name}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
    expect(rawVoices.length).toBe(322);
    expect(VOICE_LANGUAGES.length).toBe(75);
    for (const v of VOICES) {
      expect(v.languageName.en, v.id).toBeTruthy();
      expect(v.languageName.ar, v.id).toBeTruthy();
      if (v.lang === "ar") expect(v.nameAr, v.id).toMatch(/\p{Script=Arabic}/u);
    }
  });

  it("has a flag asset for every country", () => {
    const countries = new Set(VOICES.map((v) => v.country).filter(Boolean));
    for (const c of countries) expect(existsSync(join(__dirname, "../../public/flags", `${c.toLowerCase()}.svg`)), c).toBe(true);
  });

  it("only labels provider-tagged voices as dialect voices", () => {
    const dialect = VOICES.filter((v) => v.categories.includes("Dialect")).map((v) => v.id);
    expect(dialect).toEqual(["zh-CN-liaoning-XiaobeiNeural", "zh-CN-shaanxi-XiaoniNeural"]);
    expect(VOICES.filter((v) => v.lang === "ar").every((v) => !v.categories.includes("Dialect"))).toBe(true);
  });

  it("searches across all voices with Arabic demonyms and normalization", () => {
    const ids = (q: string) => filterVoices({ ...EMPTY_FILTERS, query: q }).map((v) => v.id);
    expect(ids("عراقي")).toEqual(expect.arrayContaining(["ar-IQ-RanaNeural", "ar-IQ-BasselNeural"]));
    expect(ids("اماني")).toContain("ar-SY-AmanyNeural");
    expect(ids("ليلي").length).toBe(2); // Laila (BH) and Layla (LB)
    expect(ids("egyptian female")).toEqual(["ar-EG-SalmaNeural"]);
    expect(ids("سلمى")).toContain("ar-EG-SalmaNeural"); // found regardless of other filters' defaults
  });

  it("filters by language, region and gender", () => {
    const gulf = filterVoices({ ...EMPTY_FILTERS, lang: "ar", region: "gulf" });
    expect(new Set(gulf.map((v) => v.country))).toEqual(new Set(["SA", "AE", "KW", "QA", "BH", "OM"]));
    const male = filterVoices({ ...EMPTY_FILTERS, lang: "ar", gender: "Male" });
    expect(male.every((v) => v.gender === "Male")).toBe(true);
    expect(filterVoices({ ...EMPTY_FILTERS, multilingualOnly: true }).length).toBe(12);
    expect(PERSONALITIES.length).toBeGreaterThan(10);
  });

  it("groups by language with Arabic first", () => {
    const groups = groupVoices(VOICES, "en", false);
    expect(groups[0].key).toBe("ar");
    expect(groups.reduce((n, g) => n + g.voices.length, 0)).toBe(VOICES.length);
  });

  it("suggests a first-visit voice from browser languages", () => {
    expect(getVoice(suggestVoiceId(["ar-IQ", "en"]))?.locale).toBe("ar-IQ");
    expect(getVoice(suggestVoiceId(["fr-FR"]))?.lang).toBe("fr");
    expect(suggestVoiceId(["en-US"])).toBe(DEFAULT_VOICE_ID);
  });

  it("maps backup voices only to the same language", () => {
    expect(backupLanguageFor("ar-IQ")).toBe("ar");
    expect(backupLanguageFor("he-IL")).toBe("iw");
    expect(backupLanguageFor("zh-HK")).toBeNull(); // Cantonese: no faithful backup
    expect(backupLanguageFor("iu-Cans-CA")).toBeNull();
  });

  it("has a hand-written preview sentence for every major language", () => {
    for (const lang of ["en", "ar", "fr", "es", "de", "zh", "ja", "ko", "hi", "ru", "tr", "fa", "ur"]) {
      expect(PREVIEW_SAMPLES[lang], lang).toContain("{name}");
    }
  });
});

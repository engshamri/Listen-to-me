import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "@/lib/i18n/translate";
import { VOICES } from "@/lib/voices/catalog";
import { LANGUAGE_CATEGORIES, categoryOf, countriesIn, groupByRegion, summarizeCategories } from "@/lib/voices/categories";

describe("voice categories", () => {
  it("places every voice in exactly one category by its language", () => {
    for (const v of VOICES) expect(LANGUAGE_CATEGORIES, v.id).toContain(categoryOf(v));
    const other = VOICES.filter((v) => categoryOf(v) === "other").map((v) => v.lang);
    expect(new Set(other)).toEqual(new Set(["iu"])); // only Inuktitut lacks a better group
  });

  it("lists the Arabic-speaking countries that really have voices, grouped by accent region", () => {
    const countries = countriesIn("arabic", VOICES, "en");
    expect(countries.map((c) => c.code).sort()).toEqual(["AE", "BH", "DZ", "EG", "IQ", "JO", "KW", "LB", "LY", "MA", "OM", "QA", "SA", "SY", "TN", "YE"]);
    for (const c of countries) for (const v of c.voices) expect(v.country).toBe(c.code);
    const regions = groupByRegion(countries);
    expect(regions.map((r) => r.region)).toEqual(["gulf", "levant", "iraq", "egypt", "maghreb", "yemen"]);
    expect(regions.reduce((n, r) => n + r.countries.length, 0)).toBe(16);
  });

  it("keeps a country's voices within the chosen language group", () => {
    const india = countriesIn("asian", VOICES, "en").find((c) => c.code === "IN")!;
    expect(india.voices.every((v) => v.lang !== "en")).toBe(true); // English (India) is under English
    expect(india.languages.length).toBeGreaterThan(3);
    const canadaFrench = countriesIn("european", VOICES, "en").find((c) => c.code === "CA")!;
    expect(canadaFrench.voices.every((v) => v.lang === "fr")).toBe(true);
  });

  it("summarizes categories with counts that add up to the whole library", () => {
    const summary = summarizeCategories(VOICES);
    expect(summary.reduce((n, c) => n + c.voices, 0)).toBe(VOICES.length);
    expect(summary.find((c) => c.id === "arabic")).toMatchObject({ countries: 16, languages: 1 });
  });

  it("has localized category names and country counts", () => {
    const ar = createTranslator("ar");
    expect(ar("voices.categories.european")).toBe("اللغات الأوروبية");
    expect(ar("voices.countries", { count: 16 })).toBe("16 بلداً");
    expect(createTranslator("en")("voices.countries", { count: 1 })).toBe("1 country");
  });
});

describe("favorites", () => {
  beforeEach(() => {
    vi.resetModules();
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
  });

  it("adds, removes and persists favorites (newest first)", async () => {
    const { toggleFavorite } = await import("@/lib/voices/favorites");
    expect(toggleFavorite("ar-IQ-RanaNeural")).toBe(true);
    expect(toggleFavorite("en-US-GuyNeural")).toBe(true);
    expect(JSON.parse(localStorage.getItem("asmani:favorites")!)).toEqual(["en-US-GuyNeural", "ar-IQ-RanaNeural"]);
    expect(toggleFavorite("ar-IQ-RanaNeural")).toBe(false);
    expect(JSON.parse(localStorage.getItem("asmani:favorites")!)).toEqual(["en-US-GuyNeural"]);
  });

  it("ignores unknown voices and corrupt storage", async () => {
    localStorage.setItem("asmani:favorites", JSON.stringify(["ar-IQ-RanaNeural", "xx-Fake", "ar-IQ-RanaNeural", 42]));
    const { toggleFavorite } = await import("@/lib/voices/favorites");
    toggleFavorite("en-US-GuyNeural");
    expect(JSON.parse(localStorage.getItem("asmani:favorites")!)).toEqual(["en-US-GuyNeural", "ar-IQ-RanaNeural"]);

    vi.resetModules();
    localStorage.setItem("asmani:favorites", "{not json");
    const fresh = await import("@/lib/voices/favorites");
    expect(fresh.toggleFavorite("ar-EG-SalmaNeural")).toBe(true);
  });
});

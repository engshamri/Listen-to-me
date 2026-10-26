// Builds src/data/voice-catalog.json from the raw provider list in
// src/data/voices.json, and copies the SVG flags it needs into public/flags.
//
// Localized language/country names are generated here (with Node's ICU data)
// rather than in the browser, so server and client always render identical
// strings and the bundle carries no locale tables.
//
//   node scripts/build-voice-catalog.mjs
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const raw = JSON.parse(readFileSync(join(root, "src/data/voices.json"), "utf8"));

// Verdicts from scripts/voice-qa/run_audit.py: voices the audit confirmed as
// broken are kept in the data but marked unavailable (hidden, rejected by the API).
const qualityPath = join(root, "src/data/voice-quality.json");
const quality = existsSync(qualityPath) ? JSON.parse(readFileSync(qualityPath, "utf8")) : { voices: {} };
const disabled = new Set(Object.entries(quality.voices ?? {}).filter(([, q]) => q.status === "disabled").map(([id]) => id));

const langNames = { en: new Intl.DisplayNames(["en"], { type: "language" }), ar: new Intl.DisplayNames(["ar"], { type: "language" }) };
const regionNames = { en: new Intl.DisplayNames(["en"], { type: "region" }), ar: new Intl.DisplayNames(["ar"], { type: "region" }) };

/** Arabic spellings of the personal names used by the Arabic voices. */
const ARABIC_PERSONAL_NAMES = {
  Fatima: "فاطمة", Hamdan: "حمدان", Laila: "ليلى", Ali: "علي", Amina: "أمينة", Ismael: "إسماعيل",
  Salma: "سلمى", Shakir: "شاكر", Rana: "رنا", Bassel: "باسل", Sana: "سناء", Taim: "تيم",
  Noura: "نورة", Fahed: "فهد", Layla: "ليلى", Rami: "رامي", Iman: "إيمان", Omar: "عمر",
  Mouna: "منى", Jamal: "جمال", Aysha: "عائشة", Abdullah: "عبدالله", Amal: "أمل", Moaz: "معاذ",
  Zariyah: "زارية", Hamed: "حامد", Amany: "أماني", Laith: "ليث", Reem: "ريم", Hedi: "هادي",
  Maryam: "مريم", Saleh: "صالح",
};

/** Language variants the provider distinguishes (taken from its LocaleName). */
const VARIANTS = {
  "zh-CN": { en: "Mandarin", ar: "الماندرين" },
  "zh-HK": { en: "Cantonese", ar: "الكانتونية" },
  "zh-TW": { en: "Taiwanese Mandarin", ar: "الماندرين التايوانية" },
  "zh-CN-liaoning": { en: "Northeastern Mandarin (Liaoning)", ar: "الماندرين الشمالية الشرقية (لياونينغ)" },
  "zh-CN-shaanxi": { en: "Zhongyuan Mandarin (Shaanxi)", ar: "ماندرين جونغيوان (شنشي)" },
  "iu-Cans-CA": { en: "Syllabics", ar: "الكتابة المقطعية" },
  "iu-Latn-CA": { en: "Latin script", ar: "الحروف اللاتينية" },
  "sr-RS": { en: "Cyrillic", ar: "السيريلية" },
};

/** Regional groupings for Arabic voices. These are accent regions, not dialect claims. */
const ARABIC_REGIONS = {
  gulf: ["SA", "AE", "KW", "QA", "BH", "OM"],
  levant: ["SY", "LB", "JO", "PS"],
  iraq: ["IQ"],
  egypt: ["EG", "SD"],
  maghreb: ["MA", "DZ", "TN", "LY"],
  yemen: ["YE"],
};

function parseLocale(locale) {
  const parts = locale.split("-");
  const lang = parts[0];
  const country = parts.find((p, i) => i > 0 && /^[A-Z]{2}$/.test(p)) ?? "";
  return { lang, country };
}

function personalName(id, locale) {
  // "ar-IQ-RanaNeural" -> "Rana"; "en-US-AvaMultilingualNeural" -> "Ava"
  const tail = id.slice(locale.length + 1).replace(/Neural$/, "");
  return tail.replace(/Multilingual$/, "");
}

function titleCase(s) {
  return s ? s[0].toLocaleUpperCase() + s.slice(1) : s;
}

const voices = raw.map((v) => {
  const { lang, country } = parseLocale(v.locale);
  const name = personalName(v.id, v.locale);
  const isArabic = lang === "ar";
  const region = isArabic ? Object.keys(ARABIC_REGIONS).find((r) => ARABIC_REGIONS[r].includes(country)) ?? null : null;
  return {
    id: v.id,
    provider: "edge",
    locale: v.locale,
    lang,
    country,
    gender: v.gender,
    name,
    nameAr: isArabic ? ARABIC_PERSONAL_NAMES[name] ?? name : name,
    languageName: { en: titleCase(langNames.en.of(lang) ?? lang), ar: langNames.ar.of(lang) ?? lang },
    countryName: country ? { en: regionNames.en.of(country) ?? country, ar: regionNames.ar.of(country) ?? country } : null,
    variant: VARIANTS[v.locale] ?? null,
    region,
    multilingual: /Multilingual/.test(v.id),
    personalities: v.personalities ?? [],
    categories: v.categories ?? [],
    available: v.available !== false && !disabled.has(v.id),
  };
});
if (disabled.size) console.log(`disabled by quality audit: ${[...disabled].join(", ")}`);

// Some English voices exist twice under the same name: an English-only version and a
// multilingual one ("Ava" and "Ava Multilingual"). The list would show two identical
// cards, so only the multilingual twin (which also reads other languages) is offered;
// the other is hidden and points to its twin, so saved choices keep working.
for (const v of voices) {
  if (v.multilingual) continue;
  const twin = voices.find((w) => w.multilingual && w.available && w.locale === v.locale && w.name === v.name);
  if (!twin) continue;
  v.available = false;
  v.duplicateOf = twin.id;
}
const duplicates = voices.filter((v) => v.duplicateOf);
if (duplicates.length) console.log(`hidden as duplicates of a multilingual twin: ${duplicates.map((v) => `${v.id} → ${v.duplicateOf}`).join(", ")}`);

const missingArabic = voices.filter((v) => v.lang === "ar" && v.nameAr === v.name).map((v) => v.id);
if (missingArabic.length) {
  console.error("Arabic voices without an Arabic personal name:", missingArabic.join(", "));
  process.exit(1);
}

writeFileSync(join(root, "src/data/voice-catalog.json"), JSON.stringify(voices) + "\n");

// ---- flags ----
const flagSrc = join(root, "node_modules/flag-icons/flags/4x3");
const flagDest = join(root, "public/flags");
const countries = [...new Set(voices.map((v) => v.country).filter(Boolean))].map((c) => c.toLowerCase());
if (existsSync(flagSrc)) {
  rmSync(flagDest, { recursive: true, force: true });
  mkdirSync(flagDest, { recursive: true });
  const missing = [];
  for (const c of countries) {
    const file = join(flagSrc, `${c}.svg`);
    if (existsSync(file)) copyFileSync(file, join(flagDest, `${c}.svg`));
    else missing.push(c);
  }
  if (missing.length) console.warn("No flag asset for:", missing.join(", "));
  console.log(`flags: ${readdirSync(flagDest).length} copied to public/flags`);
} else {
  console.warn("flag-icons not installed; flags not refreshed (existing public/flags kept).");
}

const langs = new Set(voices.map((v) => v.lang));
console.log(`catalog: ${voices.length} voices, ${langs.size} languages, ${countries.length} countries, ${voices.filter((v) => v.multilingual).length} multilingual`);

/** Text statistics: word counts, script detection and duration estimates. */

type WordSegmenter = { segment(input: string): Iterable<{ segment: string; isWordLike?: boolean }> };

let wordSegmenter: WordSegmenter | null | undefined;
function getWordSegmenter(): WordSegmenter | null {
  if (wordSegmenter !== undefined) return wordSegmenter;
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: object) => WordSegmenter }).Segmenter;
  wordSegmenter = Seg ? new Seg(undefined, { granularity: "word" }) : null;
  return wordSegmenter;
}

/** Counts words; uses ICU word segmentation so CJK text without spaces counts correctly. */
export function countWords(text: string): number {
  if (!text.trim()) return 0;
  const seg = getWordSegmenter();
  if (!seg) return text.trim().split(/\s+/u).length;
  let n = 0;
  for (const s of seg.segment(text)) if (s.isWordLike) n++;
  return n;
}

export type Script =
  | "Arabic" | "Latin" | "Cyrillic" | "Greek" | "Hebrew" | "Han" | "Kana" | "Hangul" | "Devanagari"
  | "Bengali" | "Tamil" | "Telugu" | "Kannada" | "Malayalam" | "Gujarati" | "Thai" | "Lao" | "Khmer"
  | "Myanmar" | "Georgian" | "Ethiopic" | "Sinhala" | "Armenian" | "CanadianSyllabics";

const SCRIPT_TESTS: [Script, RegExp][] = [
  ["Arabic", /\p{Script=Arabic}/u],
  ["Latin", /\p{Script=Latin}/u],
  ["Cyrillic", /\p{Script=Cyrillic}/u],
  ["Greek", /\p{Script=Greek}/u],
  ["Hebrew", /\p{Script=Hebrew}/u],
  ["Kana", /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ["Han", /\p{Script=Han}/u],
  ["Hangul", /\p{Script=Hangul}/u],
  ["Devanagari", /\p{Script=Devanagari}/u],
  ["Bengali", /\p{Script=Bengali}/u],
  ["Tamil", /\p{Script=Tamil}/u],
  ["Telugu", /\p{Script=Telugu}/u],
  ["Kannada", /\p{Script=Kannada}/u],
  ["Malayalam", /\p{Script=Malayalam}/u],
  ["Gujarati", /\p{Script=Gujarati}/u],
  ["Thai", /\p{Script=Thai}/u],
  ["Lao", /\p{Script=Lao}/u],
  ["Khmer", /\p{Script=Khmer}/u],
  ["Myanmar", /\p{Script=Myanmar}/u],
  ["Georgian", /\p{Script=Georgian}/u],
  ["Ethiopic", /\p{Script=Ethiopic}/u],
  ["Sinhala", /\p{Script=Sinhala}/u],
  ["Armenian", /\p{Script=Armenian}/u],
  ["CanadianSyllabics", /\p{Script=Canadian_Aboriginal}/u],
];

/** Returns the dominant writing system of the text (sampled), or null for no letters. */
export function detectScript(text: string): Script | null {
  const sample = text.length > 4000 ? text.slice(0, 4000) : text;
  const counts = new Map<Script, number>();
  for (const ch of sample) {
    if (!/\p{L}/u.test(ch)) continue;
    for (const [name, re] of SCRIPT_TESTS) {
      if (re.test(ch)) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
        break;
      }
    }
  }
  // Japanese mixes Kana with Han; any meaningful Kana means Japanese text.
  const kana = counts.get("Kana") ?? 0;
  if (kana > 0 && kana >= (counts.get("Han") ?? 0) * 0.1) {
    counts.set("Kana", kana + (counts.get("Han") ?? 0));
    counts.delete("Han");
  }
  let best: Script | null = null;
  let max = 0;
  for (const [k, v] of counts) if (v > max) [best, max] = [k, v];
  return best;
}

/** Scripts each voice language is written in. Languages not listed are not checked. */
const LANG_SCRIPTS: Record<string, Script[]> = {
  ar: ["Arabic"], fa: ["Arabic"], ur: ["Arabic"], ps: ["Arabic"],
  ru: ["Cyrillic"], uk: ["Cyrillic"], bg: ["Cyrillic"], mk: ["Cyrillic"], kk: ["Cyrillic"], mn: ["Cyrillic"],
  sr: ["Cyrillic", "Latin"], el: ["Greek"], he: ["Hebrew"], zh: ["Han"], ja: ["Kana", "Han"], ko: ["Hangul"],
  hi: ["Devanagari"], mr: ["Devanagari"], ne: ["Devanagari"], bn: ["Bengali"], ta: ["Tamil"], te: ["Telugu"],
  kn: ["Kannada"], ml: ["Malayalam"], gu: ["Gujarati"], th: ["Thai"], lo: ["Lao"], km: ["Khmer"],
  my: ["Myanmar"], ka: ["Georgian"], am: ["Ethiopic"], si: ["Sinhala"],
  en: ["Latin"], fr: ["Latin"], es: ["Latin"], de: ["Latin"], it: ["Latin"], pt: ["Latin"], nl: ["Latin"],
  tr: ["Latin"], id: ["Latin"], ms: ["Latin"], vi: ["Latin"], pl: ["Latin"], sv: ["Latin"], da: ["Latin"],
  nb: ["Latin"], fi: ["Latin"], cs: ["Latin"], sk: ["Latin"], hu: ["Latin"], ro: ["Latin"], hr: ["Latin"],
  sl: ["Latin"], et: ["Latin"], lv: ["Latin"], lt: ["Latin"], ca: ["Latin"], gl: ["Latin"], af: ["Latin"],
  sw: ["Latin"], fil: ["Latin"], ga: ["Latin"], cy: ["Latin"], is: ["Latin"], mt: ["Latin"], sq: ["Latin"],
  bs: ["Latin"], so: ["Latin"], zu: ["Latin"], jv: ["Latin"], su: ["Latin"], uz: ["Latin"], az: ["Latin"],
};

/**
 * True when the text's script is not one the voice's language is written in.
 * Multilingual voices are never flagged.
 */
export function scriptMismatch(script: Script | null, voiceLang: string, multilingual: boolean): boolean {
  if (!script || multilingual) return false;
  const expected = LANG_SCRIPTS[voiceLang];
  if (!expected) return false;
  return !expected.includes(script);
}

/**
 * Rough spoken duration in seconds. Neural voices speak ~150 words per minute
 * at normal speed; Arabic words are longer on average, and scripts written
 * without spaces are estimated per character instead.
 */
export function estimateDurationSeconds(text: string, speed = 1, words = countWords(text)): number {
  if (!text.trim()) return 0;
  const script = detectScript(text);
  let seconds: number;
  if (script === "Han" || script === "Kana") seconds = text.replace(/\s/gu, "").length / 4.5;
  else if (script === "Arabic") seconds = words / 2.2;
  else seconds = words / 2.5;
  return Math.max(1, Math.round(seconds / Math.max(0.25, speed)));
}

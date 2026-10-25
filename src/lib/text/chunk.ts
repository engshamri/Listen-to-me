/**
 * Language-aware text segmentation for speech synthesis.
 *
 * Long text is split into chunks that each fit in one synthesis request.
 * Boundaries are chosen in this order of preference: paragraph end, sentence
 * end, word boundary. A word is never cut in half unless a single "word" is
 * itself longer than a chunk (e.g. a pasted hash), in which case it is split
 * between code points so no character is corrupted.
 */

export const DEFAULT_CHUNK_SIZE = 1800;

type Segmenter = { segment(input: string): Iterable<{ segment: string; isWordLike?: boolean }> };

function makeSegmenter(locale: string, granularity: "sentence" | "word"): Segmenter | null {
  const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: object) => Segmenter }).Segmenter;
  if (!Seg) return null;
  try {
    return new Seg(locale, { granularity });
  } catch {
    return new Seg("en", { granularity });
  }
}

/** Sentence-ending punctuation across the scripts we support. */
const SENTENCE_END = /[.!?؟。！？…।॥۔።]["'”’»)\]]*\s*$/u;
const FALLBACK_SENTENCE = /[^.!?؟。！？…।॥۔።\n]+(?:[.!?؟。！？…।॥۔።]+["'”’»)\]]*)?\s*|\n+/gu;

export function splitSentences(text: string, locale = "en"): string[] {
  if (!text) return [];
  const seg = makeSegmenter(locale, "sentence");
  if (seg) return Array.from(seg.segment(text), (s) => s.segment);
  return text.match(FALLBACK_SENTENCE) ?? [text];
}

/** Split one over-long sentence at word boundaries. */
function splitAtWords(sentence: string, maxLen: number, locale: string): string[] {
  const seg = makeSegmenter(locale, "word");
  const words = seg ? Array.from(seg.segment(sentence), (s) => s.segment) : sentence.split(/(?<=\s)/u);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur.length + w.length <= maxLen) {
      cur += w;
      continue;
    }
    if (cur.trim()) out.push(cur);
    if (w.length <= maxLen) {
      cur = w;
    } else {
      // A single token longer than a chunk: split between code points.
      const cps = Array.from(w);
      for (let i = 0; i < cps.length; i += maxLen) out.push(cps.slice(i, i + maxLen).join(""));
      cur = "";
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export interface ChunkOptions {
  maxLen?: number;
  locale?: string;
}

/**
 * Split text into synthesis chunks no longer than `maxLen` characters.
 * Concatenating the returned chunks reproduces every non-whitespace character
 * of the input, in order.
 */
export function splitIntoChunks(text: string, { maxLen = DEFAULT_CHUNK_SIZE, locale = "en" }: ChunkOptions = {}): string[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (!normalized.trim()) return [];
  if (normalized.length <= maxLen) return [normalized.trim()];

  // Units are sentences; we remember which ones close a paragraph so that
  // chunk boundaries can prefer paragraph breaks.
  const units: { text: string; paragraphEnd: boolean }[] = [];
  for (const s of splitSentences(normalized, locale)) {
    const paragraphEnd = /\n\s*\n\s*$/.test(s) || /\n\s*$/.test(s);
    if (s.length <= maxLen) units.push({ text: s, paragraphEnd });
    else for (const piece of splitAtWords(s, maxLen, locale)) units.push({ text: piece, paragraphEnd: false });
  }

  const chunks: string[] = [];
  let cur = "";
  const flush = () => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = "";
  };
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (cur.length + u.text.length > maxLen) flush();
    cur += u.text;
    // Close the chunk early at a paragraph end once it is reasonably full, so
    // the following paragraph starts a fresh request with natural prosody.
    if (u.paragraphEnd && cur.length >= maxLen * 0.6) flush();
  }
  flush();
  return chunks;
}

const FULL_STOP_BY_LANG: Record<string, string> = {
  zh: "。",
  ja: "。",
  yue: "。",
  hi: "।",
  mr: "।",
  ne: "।",
  bn: "।",
  am: "።",
};

/**
 * Prepare a chunk for the speech engine without changing what the user sees:
 * lines that end without punctuation (headings, list items) get a full stop so
 * the voice pauses instead of running them into the next line.
 */
export function prepareForSpeech(chunk: string, { lang = "en", pauseAtLineBreaks = true } = {}): string {
  if (!pauseAtLineBreaks) return chunk;
  const stop = FULL_STOP_BY_LANG[lang] ?? ".";
  return chunk
    .split("\n")
    .map((line) => {
      const trimmed = line.trimEnd();
      if (!trimmed.trim()) return trimmed;
      if (SENTENCE_END.test(trimmed) || /[,،;؛:]$/u.test(trimmed)) return trimmed;
      return trimmed + stop;
    })
    .join("\n");
}

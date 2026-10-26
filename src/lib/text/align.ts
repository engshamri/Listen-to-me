/**
 * Maps the words the speech service reports back onto the text the reader sees.
 *
 * Synthesis chunks are trimmed, contiguous substrings of the editor text, and the
 * service reports each spoken word as written (e.g. "3.5%", "مرحباً"), so words are
 * matched in order with a forward-only cursor. Tokens that can't be found nearby
 * (such as the full stops added for pauses) are skipped rather than guessed.
 */

/** A spoken word: times in seconds from the start of its audio. */
export interface SpeechWord {
  start: number;
  end: number;
  text: string;
}

/** A piece of the displayed text ([from, to) offsets) and when it is spoken. */
export interface Span {
  from: number;
  to: number;
  start: number;
  end: number;
}

/** How far ahead a word may be found; further means the text and the audio disagree. */
const SEARCH_WINDOW = 160;

/** Start offset of each chunk within `text`; chunks appear in order and never overlap. */
export function locateChunks(text: string, chunks: string[]): number[] {
  const starts: number[] = [];
  let cursor = 0;
  for (const chunk of chunks) {
    const at = text.indexOf(chunk, cursor);
    const start = at < 0 ? cursor : at;
    starts.push(start);
    cursor = start + chunk.length;
  }
  return starts;
}

/** Places each spoken word in `chunk` (which starts at `base` in the full text). */
export function alignWords(chunk: string, words: SpeechWord[], base = 0): Span[] {
  const spans: Span[] = [];
  let cursor = 0;
  for (const w of [...words].sort((a, b) => a.start - b.start)) {
    const token = w.text.trim();
    if (!token) continue;
    const at = chunk.indexOf(token, cursor);
    if (at < 0 || at - cursor > SEARCH_WINDOW) continue;
    spans.push({ from: base + at, to: base + at + token.length, start: w.start, end: Math.max(w.end, w.start) });
    cursor = at + token.length;
  }
  return spans;
}

/**
 * When the service sent no word timings (the backup voice), spread the chunk's
 * duration over its words in proportion to their length.
 */
export function estimateWords(chunk: string, duration: number, base = 0): Span[] {
  const words = [...chunk.matchAll(/\S+/gu)];
  const total = words.reduce((n, m) => n + m[0].length, 0);
  if (!total || duration <= 0) return [];
  const spans: Span[] = [];
  let elapsed = 0;
  for (const m of words) {
    const length = (m[0].length / total) * duration;
    spans.push({ from: base + m.index, to: base + m.index + m[0].length, start: elapsed, end: elapsed + length });
    elapsed += length;
  }
  return spans;
}

/**
 * Sentence spans with times taken from the words inside them. A sentence lasts
 * until the next one starts, so the box stays put during the pause between them.
 * Sentences without any timed word (only punctuation or symbols) are left out.
 */
export function sentenceSpans(sentences: { from: number; to: number }[], words: Span[], textEnd: number): Span[] {
  const out: Span[] = [];
  let w = 0;
  for (const s of sentences) {
    while (w < words.length && words[w].from < s.from) w++;
    let first = -1;
    let last = -1;
    for (let i = w; i < words.length && words[i].from < s.to; i++) {
      if (first < 0) first = i;
      last = i;
    }
    if (first < 0) continue;
    out.push({ from: s.from, to: s.to, start: words[first].start, end: words[last].end });
  }
  for (let i = 0; i < out.length - 1; i++) out[i].end = Math.max(out[i].end, out[i + 1].start);
  if (out.length) out[out.length - 1].to = Math.min(out[out.length - 1].to, textEnd);
  return out;
}

/** Index of the last span that has started at time `t`, or -1 before the first one. */
export function locate(spans: Span[], t: number): number {
  let lo = 0;
  let hi = spans.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

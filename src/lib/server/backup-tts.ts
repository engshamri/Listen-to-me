import { mp3DurationSeconds } from "@/lib/audio/mp3";
import type { SpeechWord } from "@/lib/text/align";

/**
 * Google Translate's free speech endpoint (no key, no account). It has one
 * generic voice per language, reads at most ~200 characters per request and
 * ignores speed and pitch. It serves the Google Arabic voice in the catalog,
 * and the backup voice the user can explicitly accept when Microsoft's
 * service fails.
 */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const MAX_PIECE = 180;

/** Splits at whitespace so words are never cut; very long tokens are split by code point. */
function splitAtWords(text: string): string[] {
  const pieces: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/u).filter(Boolean)) {
    if (word.length > MAX_PIECE) {
      if (cur) pieces.push(cur);
      cur = "";
      const cps = Array.from(word);
      for (let i = 0; i < cps.length; i += MAX_PIECE) pieces.push(cps.slice(i, i + MAX_PIECE).join(""));
      continue;
    }
    if (cur && cur.length + 1 + word.length > MAX_PIECE) {
      pieces.push(cur);
      cur = word;
    } else {
      cur = cur ? `${cur} ${word}` : word;
    }
  }
  if (cur) pieces.push(cur);
  return pieces;
}

/**
 * Pieces of at most 180 characters that end at a sentence end when possible,
 * else at a comma or semicolon, else between words. The voice pauses at the
 * end of every request, so cutting mid-sentence would sound unnatural.
 */
export function splitForBackup(text: string, lang = "en"): string[] {
  const units: string[] = [];
  const sentences = [...new Intl.Segmenter(lang, { granularity: "sentence" }).segment(text)].map((s) => s.segment.replace(/\s+/gu, " ").trim()).filter(Boolean);
  for (const sentence of sentences) {
    if (sentence.length <= MAX_PIECE) {
      units.push(sentence);
      continue;
    }
    // Long sentence: split after clause punctuation, then between words.
    for (const clause of sentence.split(/(?<=[,،;؛:])\s+/u)) units.push(...(clause.length <= MAX_PIECE ? [clause] : splitAtWords(clause)));
  }
  const pieces: string[] = [];
  for (const unit of units) {
    const last = pieces.at(-1);
    if (last !== undefined && last.length + 1 + unit.length <= MAX_PIECE) pieces[pieces.length - 1] = `${last} ${unit}`;
    else pieces.push(unit);
  }
  return pieces;
}

/** Word times for one piece, in proportion to each word's length (the service reports none). */
export function estimatePieceWords(piece: string, start: number, duration: number): SpeechWord[] {
  const tokens = piece.split(/\s+/u).filter(Boolean);
  const total = tokens.reduce((n, w) => n + w.length + 1, 0);
  let at = 0;
  return tokens.map((text) => {
    const from = start + (duration * at) / total;
    at += text.length + 1;
    return { text, start: from, end: start + (duration * at) / total };
  });
}

export interface GoogleSpeech {
  audio: Buffer;
  /** Estimated within each piece (accurate to within a piece of at most 180 characters). */
  words: SpeechWord[];
}

export async function synthesizeGoogle(text: string, lang: string, signal?: AbortSignal): Promise<GoogleSpeech> {
  const buffers: Buffer[] = [];
  const words: SpeechWord[] = [];
  let offset = 0;
  for (const piece of splitForBackup(text, lang)) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(piece)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Referer: "https://translate.google.com/" },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Google speech HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 200) throw new Error("Google speech returned no audio");
    const duration = mp3DurationSeconds(new Uint8Array(buf));
    words.push(...estimatePieceWords(piece, offset, duration));
    offset += duration;
    buffers.push(buf);
    await new Promise((r) => setTimeout(r, 120));
  }
  return { audio: Buffer.concat(buffers), words };
}

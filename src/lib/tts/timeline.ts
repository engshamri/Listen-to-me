import { mp3DurationSeconds } from "@/lib/audio/mp3";
import { alignWords, estimateWords, locateChunks, sentenceSpans, type Span, type SpeechWord } from "@/lib/text/align";
import { splitSentences } from "@/lib/text/chunk";

/**
 * Read-along timeline for one result: which part of the text is spoken when,
 * in the time of the joined MP3. Each chunk's word times are shifted by the
 * length of the chunks before it, measured from their MP3 frames (the joined
 * file is exactly their sum, so the timeline doesn't drift).
 */
export interface Timeline {
  /** The text the audio covers (a partial result covers only its leading parts). */
  text: string;
  sentences: Span[];
  words: Span[];
  /** True when some parts had no word timings and were estimated (backup voice). */
  approximate: boolean;
}

export const EMPTY_TIMELINE: Timeline = { text: "", sentences: [], words: [], approximate: false };

export interface TimelineInput {
  /** Normalized editor text the chunks were cut from. */
  text: string;
  /** Chunks as cut from `text`, before `prepareForSpeech`. */
  displayChunks: string[];
  /** Audio of the leading finished chunks, in order. */
  audio: ArrayBuffer[];
  /** Word timings per chunk; null or empty when the voice sent none. */
  words: (SpeechWord[] | null)[];
  locale: string;
}

export function buildTimeline({ text, displayChunks, audio, words, locale }: TimelineInput): Timeline {
  const count = audio.length;
  if (!count) return EMPTY_TIMELINE;
  const starts = locateChunks(text, displayChunks);
  const covered = text.slice(0, starts[count - 1] + displayChunks[count - 1].length);

  const timed: Span[] = [];
  let offset = 0;
  let approximate = false;
  for (let i = 0; i < count; i++) {
    const duration = mp3DurationSeconds(new Uint8Array(audio[i]));
    let spans = words[i]?.length ? alignWords(displayChunks[i], words[i]!, starts[i]) : [];
    if (!spans.length) {
      spans = estimateWords(displayChunks[i], duration, starts[i]);
      approximate = true;
    }
    for (const s of spans) timed.push({ from: s.from, to: s.to, start: offset + s.start, end: offset + Math.min(s.end, duration) });
    offset += duration;
  }

  const sentences: { from: number; to: number }[] = [];
  let at = 0;
  for (const segment of splitSentences(covered, locale)) {
    const lead = segment.length - segment.trimStart().length;
    const body = segment.trim();
    if (body) sentences.push({ from: at + lead, to: at + lead + body.length });
    at += segment.length;
  }
  return { text: covered, sentences: sentenceSpans(sentences, timed, covered.length), words: timed, approximate };
}

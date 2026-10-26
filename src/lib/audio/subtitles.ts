import type { Span } from "@/lib/text/align";
import type { Timeline } from "@/lib/tts/timeline";

/**
 * Subtitles from a read-along timeline: one cue per sentence, with long
 * sentences split at word boundaries so a cue never exceeds two lines.
 */

const MAX_LINE = 42;
const MAX_CUE = MAX_LINE * 2;
const MIN_CUE_SECONDS = 0.3;

export interface Cue {
  start: number;
  end: number;
  text: string;
}

const clean = (s: string) => s.replace(/\s+/gu, " ").trim();

/** Breaks a cue into two lines at the space nearest the middle when it is too long for one. */
function wrap(text: string): string {
  if (text.length <= MAX_LINE) return text;
  const middle = text.length / 2;
  let best = -1;
  for (let i = text.indexOf(" "); i >= 0; i = text.indexOf(" ", i + 1)) {
    if (best < 0 || Math.abs(i - middle) < Math.abs(best - middle)) best = i;
  }
  return best < 0 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}

export function subtitleCues(t: Timeline): Cue[] {
  const cues: Cue[] = [];
  const push = (from: number, to: number, start: number, end: number) => {
    const text = clean(t.text.slice(from, to));
    if (text) cues.push({ start, end: Math.max(end, start + MIN_CUE_SECONDS), text: wrap(text) });
  };
  let w = 0;
  for (const s of t.sentences) {
    if (clean(t.text.slice(s.from, s.to)).length <= MAX_CUE) {
      push(s.from, s.to, s.start, s.end);
      continue;
    }
    while (w < t.words.length && t.words[w].from < s.from) w++;
    let group: Span[] = [];
    for (let i = w; i < t.words.length && t.words[i].from < s.to; i++) {
      const word = t.words[i];
      if (group.length && clean(t.text.slice(group[0].from, word.to)).length > MAX_CUE) {
        push(group[0].from, word.from, group[0].start, word.start);
        group = [];
      }
      group.push(word);
    }
    if (group.length) push(group[0].from, s.to, group[0].start, s.end);
  }
  return cues;
}

function timestamp(seconds: number, separator: "," | "."): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const p = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${separator}${p(ms % 1000, 3)}`;
}

export function toSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${timestamp(c.start, ",")} --> ${timestamp(c.end, ",")}\n${c.text}\n`).join("\n");
}

export function toVtt(cues: Cue[]): string {
  return `WEBVTT\n\n${cues.map((c) => `${timestamp(c.start, ".")} --> ${timestamp(c.end, ".")}\n${c.text}\n`).join("\n")}`;
}

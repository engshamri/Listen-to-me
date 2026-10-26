"use client";

import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { locate, type Span } from "@/lib/text/align";
import type { Timeline } from "@/lib/tts/timeline";
import { cn } from "@/lib/utils";

/*
 * Read-along: the text of a result, following its audio. Words already spoken
 * are dark, words still to come are grey, the current word is highlighted and
 * the current sentence sits in a box. Only the current sentence is split into
 * words, so even 300,000-character texts stay light.
 */

export interface ReadAlongPosition {
  sentence: number;
  word: number;
  /** False until playback first starts: the text then shows in its normal colour. */
  started: boolean;
}

/** Follows `audio`: the sentence and word being spoken, re-rendering only when they change. */
export function useReadAlong(audio: HTMLAudioElement | null, timeline: Timeline): ReadAlongPosition {
  const [position, setPosition] = useState<ReadAlongPosition>({ sentence: -1, word: -1, started: false });

  useEffect(() => {
    if (!audio) return;
    let frame = 0;
    const update = () => {
      const t = audio.currentTime;
      const next = { sentence: locate(timeline.sentences, t), word: locate(timeline.words, t), started: !audio.paused || t > 0 };
      setPosition((p) => (p.sentence === next.sentence && p.word === next.word && p.started === next.started ? p : next));
    };
    const loop = () => {
      update();
      frame = requestAnimationFrame(loop);
    };
    const start = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(loop);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      update();
    };
    const events: [string, () => void][] = [["play", start], ["pause", stop], ["ended", stop], ["seeked", update], ["timeupdate", update], ["emptied", update]];
    for (const [name, fn] of events) audio.addEventListener(name, fn);
    frame = requestAnimationFrame(audio.paused ? update : loop);
    return () => {
      cancelAnimationFrame(frame);
      for (const [name, fn] of events) audio.removeEventListener(name, fn);
    };
  }, [audio, timeline]);

  return position;
}

/** Moves playback to `seconds`. */
export function seekTo(audio: HTMLAudioElement, seconds: number) {
  audio.currentTime = Math.max(0, seconds);
}

/** Moves playback to `seconds` and plays from there. */
export function seekAndPlay(audio: HTMLAudioElement, seconds: number) {
  seekTo(audio, seconds);
  if (audio.paused) void audio.play().catch(() => {});
}

type SentenceState = "idle" | "read" | "current" | "upcoming";

const Sentence = memo(function Sentence({
  text,
  index,
  state,
  words,
  currentWord,
}: {
  text: string;
  index: number;
  state: SentenceState;
  /** Word spans relative to the sentence, only for the current sentence. */
  words?: { from: number; to: number }[];
  currentWord?: number;
}) {
  if (state !== "current" || !words?.length) {
    return (
      <span data-sentence={index} data-state={state} className={cn("cursor-pointer rounded-md", state === "upcoming" && "text-muted-foreground")}>
        {text}
      </span>
    );
  }
  const pieces: React.ReactNode[] = [];
  let at = 0;
  words.forEach((w, i) => {
    const gap = text.slice(at, w.from);
    if (gap) pieces.push(<span key={`g${i}`} className={i <= (currentWord ?? -1) ? "" : "text-muted-foreground"}>{gap}</span>);
    const isCurrent = i === currentWord;
    pieces.push(
      <span
        key={`w${i}`}
        data-word={i}
        data-current={isCurrent || undefined}
        className={cn(
          i > (currentWord ?? -1) && "text-muted-foreground",
          isCurrent && "bg-primary text-primary-foreground rounded-[4px] px-[2px] [box-decoration-break:clone]",
        )}
      >
        {text.slice(w.from, w.to)}
      </span>,
    );
    at = w.to;
  });
  if (at < text.length) pieces.push(<span key="tail" className={(currentWord ?? -1) >= words.length - 1 ? "" : "text-muted-foreground"}>{text.slice(at)}</span>);
  return (
    <span
      data-sentence={index}
      data-state="current"
      aria-current="true"
      className="bg-primary-soft ring-primary/40 cursor-pointer rounded-md px-[3px] py-[2px] ring-2 [box-decoration-break:clone]"
    >
      {pieces}
    </span>
  );
});

export function ReadAlong({
  timeline,
  audio,
  follow,
  label,
  className,
  style,
}: {
  timeline: Timeline;
  audio: HTMLAudioElement | null;
  /** Keep the current sentence in view while playing. */
  follow: boolean;
  label: string;
  className?: string;
  style?: CSSProperties;
}) {
  const position = useReadAlong(audio, timeline);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledAt = useRef(0);

  // Text between sentences (spaces, line breaks) is kept as-is so paragraphs look like the original.
  const segments = useMemo(() => {
    const out: ({ gap: string } | { sentence: number; from: number; to: number })[] = [];
    let at = 0;
    timeline.sentences.forEach((s, i) => {
      if (s.from > at) out.push({ gap: timeline.text.slice(at, s.from) });
      out.push({ sentence: i, from: s.from, to: s.to });
      at = s.to;
    });
    if (at < timeline.text.length) out.push({ gap: timeline.text.slice(at) });
    return out;
  }, [timeline]);

  // Word spans of the current sentence, relative to it.
  const current = timeline.sentences[position.sentence] as Span | undefined;
  const currentWords = useMemo(() => {
    if (!current) return { words: [], first: 0 };
    let first = locate(timeline.words, current.start);
    while (first > 0 && timeline.words[first - 1].from >= current.from) first--;
    while (first >= 0 && first < timeline.words.length && timeline.words[first].from < current.from) first++;
    const words: { from: number; to: number }[] = [];
    for (let i = Math.max(0, first); i < timeline.words.length && timeline.words[i].from < current.to; i++) {
      words.push({ from: timeline.words[i].from - current.from, to: Math.min(timeline.words[i].to, current.to) - current.from });
    }
    return { words, first: Math.max(0, first) };
  }, [current, timeline.words]);

  // Follow along: keep the current sentence in the upper part of the box, unless the reader just scrolled.
  useEffect(() => {
    const box = containerRef.current;
    if (!follow || !box || position.sentence < 0 || !position.started) return;
    if (Date.now() - userScrolledAt.current < 4000) return;
    const el = box.querySelector<HTMLElement>(`[data-sentence="${position.sentence}"]`);
    if (!el) return;
    const boxRect = box.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    if (elRect.top >= boxRect.top + 8 && elRect.bottom <= boxRect.bottom - 8) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.scrollTo({ top: box.scrollTop + (elRect.top - boxRect.top) - box.clientHeight / 4, behavior: reduce ? "auto" : "smooth" });
  }, [position.sentence, position.started, follow]);

  const onClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-sentence]");
    const s = el ? timeline.sentences[Number(el.dataset.sentence)] : undefined;
    if (s && audio) seekAndPlay(audio, s.start);
  };
  const markUserScroll = () => {
    userScrolledAt.current = Date.now();
  };

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={label}
      tabIndex={0}
      dir="auto"
      onClick={onClick}
      onWheel={markUserScroll}
      onTouchMove={markUserScroll}
      onKeyDown={markUserScroll}
      className={cn("scroll-thin overflow-y-auto leading-[1.9] break-words whitespace-pre-wrap", className)}
      style={style}
    >
      {segments.map((seg) =>
        "gap" in seg ? (
          seg.gap
        ) : (
          <Sentence
            key={seg.sentence}
            index={seg.sentence}
            text={timeline.text.slice(seg.from, seg.to)}
            state={!position.started ? "idle" : seg.sentence < position.sentence ? "read" : seg.sentence === position.sentence ? "current" : "upcoming"}
            words={seg.sentence === position.sentence ? currentWords.words : undefined}
            currentWord={seg.sentence === position.sentence ? position.word - currentWords.first : undefined}
          />
        ),
      )}
    </div>
  );
}

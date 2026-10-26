"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLatest, useSpeechSettings } from "./hooks";
import { ReadingMode } from "./reading-mode";
import { mp3DurationSeconds } from "@/lib/audio/mp3";
import { registerExclusivePlayer, setListeningSpeed, switchSource } from "@/lib/audio/playback";
import { useI18n } from "@/lib/i18n/provider";
import { locate } from "@/lib/text/align";
import { contiguousPrefix, type Job } from "@/lib/tts/engine";
import { buildTimeline } from "@/lib/tts/timeline";

export interface LiveSource {
  job: Job;
  text: string;
  displayChunks: string[];
  locale: string;
}

/** Switch to the longer audio once less than this much of the current audio is left. */
const SWITCH_WITHIN_S = 20;

/**
 * Listen while generating: plays the parts that are ready, in reading mode,
 * while the rest are still being generated.
 *
 * The player holds the finished leading parts as one MP3. When new parts are
 * ready and less than 20 s of the current audio is left, it switches to the
 * longer MP3 at the same second, at the pause before a sentence, so the switch
 * is not heard. (A MediaSource stream would avoid the switch, but browsers cap
 * buffered audio at around 12 MB, about 30 minutes here, which long lectures
 * exceed.)
 */
export function LiveListen({ source, generating, onClose }: { source: LiveSource; generating: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [settings] = useSpeechSettings();
  const { job } = source;
  // The job fills in as parts finish; the parent re-renders on every progress update.
  const ready = contiguousPrefix(job);
  const parts = useMemo(() => job.audio.slice(0, ready) as ArrayBuffer[], [job, ready]);
  const durations = useMemo(() => parts.map((p) => mp3DurationSeconds(new Uint8Array(p))), [parts]);
  const timeline = useMemo(
    () =>
      buildTimeline({
        text: source.text,
        displayChunks: source.displayChunks.slice(0, ready),
        audio: parts,
        words: job.words.slice(0, ready),
        locale: source.locale,
      }),
    [source, job, ready, parts],
  );

  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const loaded = useRef<{ url: string; parts: number; duration: number } | null>(null);
  const [loadedState, setLoadedState] = useState({ parts: 0, duration: 0 });
  const latest = useLatest({ parts, durations, sentences: timeline.sentences });

  // Points the player at the first `n` ready parts and continues from `at`.
  const load = useLatest((n: number, at: number, play: boolean) => {
    if (!audio) return;
    const { parts, durations } = latest.current;
    const url = URL.createObjectURL(new Blob(parts.slice(0, n), { type: "audio/mpeg" }));
    const previous = loaded.current?.url;
    const duration = durations.slice(0, n).reduce((a, b) => a + b, 0);
    loaded.current = { url, parts: n, duration };
    setLoadedState({ parts: n, duration });
    switchSource(audio, url, at, play);
    if (previous) setTimeout(() => URL.revokeObjectURL(previous), 1000);
  });

  useEffect(() => (audio ? registerExclusivePlayer(audio) : undefined), [audio]);
  useEffect(() => {
    if (audio) setListeningSpeed(audio, settings.playbackRate);
  }, [audio, settings.playbackRate]);
  useEffect(
    () => () => {
      if (loaded.current) URL.revokeObjectURL(loaded.current.url);
    },
    [],
  );

  // First part ready: start. Listener waiting at the end: continue as soon as more is ready.
  useEffect(() => {
    if (!audio || ready === 0) return;
    const current = loaded.current;
    if (!current) load.current(ready, 0, true);
    else if (ready > current.parts && audio.ended) load.current(ready, current.duration, true);
  }, [audio, ready, load]);

  // Near the end of what is loaded and more is ready: switch at the next pause between sentences.
  useEffect(() => {
    if (!audio) return;
    let frame = 0;
    const tick = () => {
      const current = loaded.current;
      const available = latest.current.parts.length;
      if (current && available > current.parts && !audio.paused && !audio.seeking) {
        const t = audio.currentTime;
        const left = current.duration - t;
        if (left < SWITCH_WITHIN_S) {
          const { sentences } = latest.current;
          const next = sentences[locate(sentences, t) + 1];
          if (left < 0.3 || (next && next.start >= t && next.start - t < 0.1)) load.current(available, t, true);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [audio, latest, load]);

  return (
    <>
      {/* data-* show how many parts are ready and how many the player holds (useful in tests). */}
      <audio ref={setAudio} preload="auto" hidden data-ready={ready} data-loaded={loadedState.parts} />
      <ReadingMode
        open
        onOpenChange={(open) => {
          if (open) return;
          audio?.pause();
          onClose();
        }}
        audio={audio}
        timeline={timeline}
        duration={loadedState.duration}
        status={generating ? t("readAlong.liveStatus", { done: ready, total: job.chunks.length }) : undefined}
      />
    </>
  );
}

"use client";

import { AArrowDown, AArrowUp, ListTree, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PLAYBACK_RATES, READING_SIZES, useSpeechSettings } from "./hooks";
import { ReadAlong, seekAndPlay, seekTo } from "./read-along";
import { ReadingBookmarks, addBookmarkAt } from "@/components/library/bookmarks";
import type { BookmarkControls } from "@/components/library/library-hooks";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { useI18n } from "@/lib/i18n/provider";
import { locate } from "@/lib/text/align";
import { chapterStarts, detectChapters } from "@/lib/text/chapters";
import type { Timeline } from "@/lib/tts/timeline";

/** Start time of the sentence before or after the one playing at `t`; "previous" first restarts the current sentence. */
export function sentenceStart(timeline: Timeline, t: number, direction: 1 | -1): number | null {
  const i = locate(timeline.sentences, t);
  if (direction > 0) return timeline.sentences[i + 1]?.start ?? null;
  if (i < 0) return 0;
  if (t - timeline.sentences[i].start > 1.5) return timeline.sentences[i].start;
  return timeline.sentences[Math.max(0, i - 1)].start;
}

/** Playing state and position of an audio element, updated a few times per second. */
function usePlayback(audio: HTMLAudioElement | null) {
  const [state, setState] = useState({ playing: false, time: 0 });
  useEffect(() => {
    if (!audio) return;
    const update = () => setState((s) => (s.playing === !audio.paused && s.time === audio.currentTime ? s : { playing: !audio.paused, time: audio.currentTime }));
    const events = ["play", "pause", "ended", "timeupdate", "seeked", "emptied"];
    for (const e of events) audio.addEventListener(e, update);
    const frame = requestAnimationFrame(update);
    return () => {
      cancelAnimationFrame(frame);
      for (const e of events) audio.removeEventListener(e, update);
    };
  }, [audio]);
  return state;
}

export function ReadingMode({
  open,
  onOpenChange,
  audio,
  timeline,
  duration,
  title,
  bookmarks,
  onExportNotes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  audio: HTMLAudioElement | null;
  timeline: Timeline;
  /** Exact length from the MP3 frames (browsers may report Infinity for joined MP3). */
  duration: number;
  /** Shown instead of "Read along", e.g. a saved recording's title. */
  title?: string;
  /** Bookmarks and notes (kept in the library). */
  bookmarks?: BookmarkControls;
  onExportNotes?: () => void;
}) {
  const { t, fmt } = useI18n();
  const [settings, setSettings] = useSpeechSettings();
  const { playing, time } = usePlayback(audio);
  const fontSize = READING_SIZES[settings.readingSize] ?? READING_SIZES[1];
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const bookmarkAdded = (start: number) => setAnnouncement(`${t("bookmarks.added")} (${fmt.clock(start)})`);
  const chapters = useMemo(() => detectChapters(timeline.text), [timeline.text]);
  const starts = useMemo(() => chapterStarts(chapters, timeline.sentences), [chapters, timeline.sentences]);
  let currentChapter = -1;
  starts.forEach((start, i) => {
    if (start !== null && start <= time + 0.05) currentChapter = i;
  });
  const chapterTitle = (i: number) => chapters[i].title || t("chapters.beginning");

  const toggle = () => {
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => {});
    else audio.pause();
  };
  const step = (direction: 1 | -1) => {
    if (!audio) return;
    const target = sentenceStart(timeline, audio.currentTime, direction);
    if (target !== null) seekAndPlay(audio, target);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    // Typing a note must never control playback.
    if (target.closest("input, textarea, select, [contenteditable='true']")) return;
    if ((e.key === "b" || e.key === "B") && !e.ctrlKey && !e.metaKey && !e.altKey && bookmarks && audio) {
      e.preventDefault();
      addBookmarkAt(bookmarks, timeline, audio.currentTime, t, bookmarkAdded);
      return;
    }
    if (target.closest("button, [role='slider']")) return;
    if (e.key === " ") {
      e.preventDefault();
      toggle();
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      // Media controls stay left-to-right in every language, so → always means "next".
      e.preventDefault();
      step(e.key === "ArrowRight" ? 1 : -1);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t("readAlong.close")}
        onKeyDown={onKeyDown}
        className="bg-background top-0 left-0 flex h-dvh max-h-dvh w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0 sm:max-w-full"
      >
        <div className="flex items-center gap-2 border-b px-4 py-3 pe-14 sm:px-6 sm:pe-16">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate" dir="auto">
              {title ?? t("readAlong.title")}
            </DialogTitle>
            {currentChapter >= 0 && (
              <p className="text-muted-foreground mt-0.5 truncate text-[13px]" dir="auto">
                {t("chapters.current", { title: chapterTitle(currentChapter) })}
              </p>
            )}
            <DialogDescription className="mt-0.5 hidden truncate text-[13px] sm:block">{t("readAlong.keys")}</DialogDescription>
            <p role="status" className="sr-only">
              {announcement}
            </p>
          </div>
          {bookmarks && <ReadingBookmarks controls={bookmarks} timeline={timeline} audio={audio} time={time} onExport={() => onExportNotes?.()} onAdded={bookmarkAdded} />}
          {chapters.length >= 2 && (
            <Popover open={chaptersOpen} onOpenChange={setChaptersOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" aria-label={t("chapters.title")}>
                  <ListTree aria-hidden />
                  <span className="hidden sm:inline">{t("chapters.title")}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-1.5">
                <nav aria-label={t("chapters.title")}>
                  <ul className="scroll-thin max-h-[60vh] overflow-y-auto">
                    {chapters.map((c, i) => {
                      const start = starts[i];
                      return (
                        <li key={c.from}>
                          <button
                            type="button"
                            disabled={start === null}
                            aria-current={i === currentChapter ? "true" : undefined}
                            onClick={() => {
                              if (audio && start !== null) seekAndPlay(audio, start);
                              setChaptersOpen(false);
                            }}
                            className="hover:bg-accent aria-[current=true]:bg-primary-soft flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-start text-sm disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <span className="min-w-0 flex-1 truncate" dir="auto">
                              {chapterTitle(i)}
                            </span>
                            <span className="text-muted-foreground shrink-0 text-[12px] tabular-nums">{start === null ? t("chapters.notGenerated") : fmt.clock(start)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </nav>
              </PopoverContent>
            </Popover>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("readAlong.smaller")}
            disabled={settings.readingSize <= 0}
            onClick={() => setSettings({ readingSize: settings.readingSize - 1 })}
          >
            <AArrowDown aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("readAlong.larger")}
            disabled={settings.readingSize >= READING_SIZES.length - 1}
            onClick={() => setSettings({ readingSize: settings.readingSize + 1 })}
          >
            <AArrowUp aria-hidden />
          </Button>
        </div>

        <ReadAlong
          timeline={timeline}
          audio={audio}
          follow
          label={t("readAlong.region")}
          className="min-h-0 flex-1 py-6 outline-none sm:py-10"
          style={{ fontSize, paddingInline: "max(1rem, calc((100% - 46rem) / 2))" }}
        />

        {/* Playback controls are not mirrored in right-to-left layouts (like any media player). */}
        <div className="bg-card border-t px-4 pt-2 pb-3 sm:px-6" dir="ltr">
          <div className="mx-auto max-w-3xl">
            <Slider
              dir="ltr"
              min={0}
              max={Math.max(duration, 0.1)}
              step={0.1}
              value={[Math.min(time, duration)]}
              onValueChange={([v]) => {
                if (audio) seekTo(audio, v);
              }}
              thumbLabel={t("readAlong.position")}
              valueText={`${fmt.clock(time)} / ${fmt.clock(duration)}`}
            />
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground w-24 text-[13px] tabular-nums">
                {fmt.clock(time)} / {fmt.clock(duration)}
              </span>
              <div className="flex flex-1 items-center justify-center gap-1">
                <Button variant="ghost" size="icon" aria-label={t("readAlong.previous")} onClick={() => step(-1)}>
                  <SkipBack aria-hidden />
                </Button>
                <Button size="icon" className="size-11 rounded-full" aria-label={playing ? t("readAlong.pause") : t("readAlong.play")} onClick={toggle}>
                  {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
                </Button>
                <Button variant="ghost" size="icon" aria-label={t("readAlong.next")} onClick={() => step(1)}>
                  <SkipForward aria-hidden />
                </Button>
              </div>
              <label className="sr-only" htmlFor="reading-speed">
                {t("readAlong.speed")}
              </label>
              <select
                id="reading-speed"
                value={settings.playbackRate}
                onChange={(e) => setSettings({ playbackRate: Number(e.target.value) })}
                className="border-input bg-background h-9 rounded-md border px-2 text-sm"
              >
                {PLAYBACK_RATES.map((r) => (
                  <option key={r} value={r}>
                    {t("readAlong.speedValue", { n: fmt.number(r) })}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

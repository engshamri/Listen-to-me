"use client";

import { Bookmark as BookmarkIcon, BookmarkPlus, Download, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { libraryErrorKey, type BookmarkControls } from "./library-hooks";
import { useLatest } from "@/components/studio/hooks";
import { seekAndPlay } from "@/components/studio/read-along";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n/provider";
import type { Translator } from "@/lib/i18n/translate";
import type { Bookmark } from "@/lib/library/store";
import { locate } from "@/lib/text/align";
import type { Timeline } from "@/lib/tts/timeline";

/**
 * Bookmarks the sentence playing at `time` (from its start, so playback resumes there).
 * Success is reported through `onAdded` (a status line, not a toast that would cover the controls).
 */
export function addBookmarkAt(controls: BookmarkControls, timeline: Timeline, time: number, t: Translator, onAdded: (start: number) => void) {
  const s = timeline.sentences[Math.max(0, locate(timeline.sentences, time))];
  if (!s) return;
  controls
    .add({ time: s.start, from: s.from, excerpt: timeline.text.slice(s.from, s.to).replace(/\s+/g, " ").trim().slice(0, 300) })
    .then(
      () => onAdded(s.start),
      (e: unknown) => toast.error(t(libraryErrorKey(e))),
    );
}

/** "Bookmark" and the bookmarks list, for the reading-mode header. */
export function ReadingBookmarks({
  controls,
  timeline,
  audio,
  time,
  onExport,
  onAdded,
}: {
  controls: BookmarkControls;
  timeline: Timeline;
  audio: HTMLAudioElement | null;
  time: number;
  onExport: () => void;
  onAdded: (start: number) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const count = controls.list.length;
  const fail = (e: unknown) => toast.error(t(libraryErrorKey(e)));

  return (
    <>
      <Button variant="ghost" size="sm" aria-label={t("bookmarks.addLabel")} onClick={() => addBookmarkAt(controls, timeline, time, t, onAdded)}>
        <BookmarkPlus aria-hidden />
        <span className="hidden md:inline">{t("bookmarks.add")}</span>
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={`${t("bookmarks.title")}: ${t("bookmarks.count", { count })}`}>
            <BookmarkIcon aria-hidden />
            <span className="tabular-nums" aria-hidden>
              {count}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-96 p-0">
          <section aria-label={t("bookmarks.title")}>
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
              <h2 className="text-sm font-semibold">{t("bookmarks.title")}</h2>
              <Button variant="ghost" size="sm" disabled={!count} onClick={onExport}>
                <Download aria-hidden />
                {t("bookmarks.export")}
              </Button>
            </div>
            {count ? (
              <ul className="scroll-thin max-h-[60vh] divide-y overflow-y-auto">
                {controls.list.map((b) => (
                  <BookmarkRow
                    key={b.id}
                    bookmark={b}
                    onPlay={() => {
                      if (audio) seekAndPlay(audio, b.time);
                      setOpen(false);
                    }}
                    onNote={(note) => void controls.setNote(b.id, note).catch(fail)}
                    onRemove={() => void controls.remove(b.id).catch(fail)}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground px-3 py-4 text-sm leading-relaxed">{t("bookmarks.empty")}</p>
            )}
          </section>
        </PopoverContent>
      </Popover>
    </>
  );
}

function BookmarkRow({ bookmark, onPlay, onNote, onRemove }: { bookmark: Bookmark; onPlay: () => void; onNote: (note: string) => void; onRemove: () => void }) {
  const { t, fmt } = useI18n();
  const time = fmt.clock(bookmark.time);
  // Notes save shortly after typing stops, on blur, and when the list closes.
  const pending = useRef<{ note: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const saved = useRef(bookmark.note);
  const onNoteRef = useLatest(onNote);
  const flush = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    if (p.note !== saved.current) {
      saved.current = p.note;
      onNoteRef.current(p.note);
    }
  }, [onNoteRef]);
  useEffect(() => flush, [flush]);
  return (
    <li className="space-y-2 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <Button variant="link" size="sm" className="h-auto shrink-0 px-0 py-0.5 font-semibold tabular-nums" onClick={onPlay} aria-label={t("bookmarks.play", { time })}>
          {time}
        </Button>
        <p className="line-clamp-3 min-w-0 flex-1 text-sm leading-snug" dir="auto">
          {bookmark.excerpt}
        </p>
        <Button variant="ghost" size="icon-sm" className="-mt-1 shrink-0" onClick={onRemove} aria-label={t("bookmarks.remove", { time })}>
          <Trash2 aria-hidden />
        </Button>
      </div>
      <Textarea
        defaultValue={bookmark.note}
        rows={2}
        dir="auto"
        aria-label={t("bookmarks.note", { time })}
        placeholder={t("bookmarks.notePlaceholder")}
        onChange={(e) => {
          if (pending.current) clearTimeout(pending.current.timer);
          pending.current = { note: e.target.value, timer: setTimeout(flush, 800) };
        }}
        onBlur={flush}
        className="min-h-0 resize-y px-2.5 py-1.5 text-sm"
      />
    </li>
  );
}

"use client";

import { AudioLines, Download, Headphones, Library, Pencil, Play, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { downloadBlob, exportNotes, inProgress, libraryErrorKey, useLibraryItems } from "./library-hooks";
import { LibraryPlayer } from "./library-player";
import { BackButton } from "@/components/app/back-button";
import { useSpeechSettings } from "@/components/studio/hooks";
import { Notice, ProgressBar } from "@/components/studio/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { downloadName } from "@/lib/audio/filename";
import { subtitleCues, toSrt } from "@/lib/audio/subtitles";
import { useI18n } from "@/lib/i18n/provider";
import { deleteItem, loadRecording, storageUsage, updateItem, type LibraryItem } from "@/lib/library/store";
import { matchesQuery, normalizeForSearch } from "@/lib/text/search";
import { getVoice, voiceName } from "@/lib/voices/catalog";

const BOM = String.fromCharCode(0xfeff);

export function LibraryPage() {
  const { t, fmt } = useI18n();
  const { items, error } = useLibraryItems();
  const [settings, setSettings] = useSpeechSettings();
  const [query, setQuery] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<LibraryItem | null>(null);
  const [usage, setUsage] = useState<number | null>(null);
  const searchId = useId();

  useEffect(() => {
    let alive = true;
    void storageUsage().then((u) => alive && setUsage(u));
    return () => {
      alive = false;
    };
  }, [items]);

  const shown = useMemo(() => (items ?? []).filter((i) => matchesQuery(normalizeForSearch(`${i.title} ${i.excerpt}`), query)), [items, query]);

  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-4xl flex-1 px-4 pt-4 pb-10 outline-none sm:px-6">
      <BackButton />
      <div className="mb-5">
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight sm:text-[28px]">
          <Library className="text-primary size-7" aria-hidden />
          {t("library.title")}
        </h1>
        <p className="text-muted-foreground mt-1 max-w-3xl text-[15px] leading-relaxed">{t("library.intro")}</p>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <label htmlFor={searchId} className="sr-only">
            {t("library.search")}
          </label>
          <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" aria-hidden />
          <Input id={searchId} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("library.search")} className="ps-9" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={settings.autoSave} onCheckedChange={(v) => setSettings({ autoSave: v })} />
          {t("library.autoSave")}
        </label>
      </div>

      {error ? (
        <Notice tone="error" role="alert">
          <p>{t(libraryErrorKey(error))}</p>
        </Notice>
      ) : items === null ? (
        <p role="status" className="text-muted-foreground py-10 text-center text-sm">
          {t("library.loading")}
        </p>
      ) : items.length === 0 ? (
        <div className="bg-card shadow-card flex flex-col items-center gap-3 rounded-xl border px-6 py-12 text-center">
          <Headphones className="text-muted-foreground size-10" aria-hidden />
          <p className="text-muted-foreground max-w-md text-[15px] leading-relaxed">{t("library.empty")}</p>
          <Button asChild>
            <Link href="/">
              <AudioLines aria-hidden />
              {t("library.emptyAction")}
            </Link>
          </Button>
        </div>
      ) : (
        <>
          <p role="status" className="text-muted-foreground mb-2 text-[13px]">
            {query.trim() && shown.length === 0 ? t("library.noMatches", { query: query.trim() }) : t("library.count", { count: shown.length })}
          </p>
          <ul className="space-y-3">
            {shown.map((item) => (
              <LibraryCard key={item.id} item={item} onListen={() => setPlaying(item.id)} onDelete={() => setDeleting(item)} />
            ))}
          </ul>
        </>
      )}

      {usage !== null && items !== null && items.length > 0 && <p className="text-muted-foreground mt-6 text-[13px]">{t("library.storage", { size: fmt.bytes(usage) })}</p>}

      {playing && <LibraryPlayer key={playing} id={playing} onClose={() => setPlaying(null)} />}

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("library.deleteTitle")}</DialogTitle>
            <DialogDescription dir="auto">{t("library.deleteBody", { title: deleting?.title ?? "" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              {t("library.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const item = deleting;
                setDeleting(null);
                if (!item) return;
                deleteItem(item.id).then(
                  () => toast.success(t("library.deleted")),
                  (e: unknown) => toast.error(t(libraryErrorKey(e))),
                );
              }}
            >
              <Trash2 aria-hidden />
              {t("library.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function LibraryCard({ item, onListen, onDelete }: { item: LibraryItem; onListen: () => void; onDelete: () => void }) {
  const { t, fmt, locale } = useI18n();
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(item.title);
  const titleId = useId();
  const voice = getVoice(item.voiceId);
  const resume = inProgress(item);
  const finished = item.lastPlayedAt !== null && item.position >= item.duration - 2;
  const created = new Date(item.createdAt);

  async function exportAs(kind: "mp3" | "txt" | "srt") {
    try {
      const { timeline, audio } = await loadRecording(item.id);
      const name = downloadName(voice?.name ?? "voice", voice?.locale ?? "xx", created, kind);
      if (kind === "mp3") downloadBlob(audio, name);
      // A byte-order mark helps desktop apps pick UTF-8 for Arabic and other scripts.
      else if (kind === "txt") downloadBlob(new Blob([BOM + timeline.text], { type: "text/plain;charset=utf-8" }), name);
      else downloadBlob(new Blob([BOM + toSrt(subtitleCues(timeline))], { type: "application/x-subrip" }), name);
    } catch (e) {
      toast.error(t(libraryErrorKey(e)));
    }
  }

  function saveTitle() {
    const next = title.replace(/\s+/g, " ").trim();
    setRenaming(false);
    if (!next || next === item.title) {
      setTitle(item.title);
      return;
    }
    updateItem(item.id, { title: next }).catch((e: unknown) => toast.error(t(libraryErrorKey(e))));
  }

  return (
    <li>
      <article aria-labelledby={titleId} className="bg-card shadow-card rounded-xl border p-4">
        {renaming ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              saveTitle();
            }}
          >
            <label htmlFor={`${titleId}-input`} className="sr-only">
              {t("library.titleLabel")}
            </label>
            <Input
              id={`${titleId}-input`}
              value={title}
              maxLength={200}
              dir="auto"
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setTitle(item.title);
                  setRenaming(false);
                }
              }}
              className="min-w-0 flex-1"
            />
            <Button type="submit" size="sm">
              {t("library.saveTitle")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setTitle(item.title);
                setRenaming(false);
              }}
            >
              {t("library.cancel")}
            </Button>
          </form>
        ) : (
          <h2 id={titleId} className="truncate text-base font-semibold" dir="auto">
            {item.title}
          </h2>
        )}
        <p className="text-muted-foreground mt-0.5 text-[13px]">
          <span dir="auto">{voice ? voiceName(voice, locale) : item.voiceId}</span> · {fmt.date(created)} · <span className="tabular-nums">{fmt.clock(item.duration)}</span>
          {item.bookmarks.length > 0 && <> · {t("bookmarks.count", { count: item.bookmarks.length })}</>}
        </p>
        <p className="text-muted-foreground mt-2 line-clamp-2 text-sm leading-relaxed" dir="auto">
          {item.excerpt}
        </p>
        {(resume || finished) && (
          <div className="mt-3 flex items-center gap-3">
            <ProgressBar
              value={(Math.min(item.position, item.duration) / Math.max(item.duration, 0.1)) * 100}
              label={t("library.resume")}
              valueText={finished ? t("library.finished") : t("library.progress", { done: fmt.clock(item.position), total: fmt.clock(item.duration) })}
              className="max-w-xs"
            />
            <span className="text-muted-foreground shrink-0 text-[13px] tabular-nums">
              {finished ? t("library.finished") : t("library.progress", { done: fmt.clock(item.position), total: fmt.clock(item.duration) })}
            </span>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onListen} aria-describedby={titleId}>
            <Play aria-hidden />
            {resume ? t("library.continue") : t("library.listen")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" aria-describedby={titleId}>
                <Download aria-hidden />
                {t("library.export")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => void exportAs("mp3")}>{t("library.exportMp3")}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportAs("txt")}>{t("library.exportText")}</DropdownMenuItem>
              {item.duration > 0 && <DropdownMenuItem onSelect={() => void exportAs("srt")}>{t("library.exportSrt")}</DropdownMenuItem>}
              {item.bookmarks.length > 0 && (
                <DropdownMenuItem
                  onSelect={() =>
                    exportNotes(
                      {
                        title: item.title,
                        details: `${voice ? voiceName(voice, locale) : item.voiceId} · ${fmt.date(created)} · ${fmt.clock(item.duration)}`,
                        bookmarks: item.bookmarks,
                        fileName: downloadName(voice?.name ?? "voice", voice?.locale ?? "xx", created, "md"),
                      },
                      t,
                      fmt,
                    )
                  }
                >
                  {t("library.exportNotes")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {!renaming && (
            <Button size="sm" variant="ghost" onClick={() => setRenaming(true)} aria-describedby={titleId}>
              <Pencil aria-hidden />
              {t("library.rename")}
            </Button>
          )}
          <Button size="sm" variant="destructive" onClick={onDelete} aria-describedby={titleId}>
            <Trash2 aria-hidden />
            {t("library.delete")}
          </Button>
        </div>
      </article>
    </li>
  );
}

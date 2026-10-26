"use client";

import { Bookmark, BookmarkMinus, Download, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { HIGHLIGHT_BG } from "./pdf-viewer";
import { useWorkspace } from "./workspace-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { downloadBlob } from "@/components/library/library-hooks";
import { useI18n } from "@/lib/i18n/provider";
import { notesMarkdown } from "@/lib/study/export";
import { addAnnotation, deleteAnnotation, updateAnnotation, type Annotation } from "@/lib/study/store";

/** Highlights, notes and bookmarks of the lecture, by page. */
export function NotesPanel({ focusNoteId }: { focusNoteId: string | null }) {
  const { t } = useI18n();
  const ws = useWorkspace();
  const bookmark = ws.annotations.find((a) => a.kind === "bookmark" && a.page === ws.page);
  const fail = () => toast.error(t("library.errors.FAILED"));

  function exportNotes() {
    const md = notesMarkdown(ws.doc.title, ws.annotations, {
      page: (n) => t("study.pageLabel", { n }),
      ocr: (percent) => t("study.ocrLabel", { percent }),
      notTranslated: t("study.notTranslated"),
      bookmark: t("study.bookmark"),
    });
    downloadBlob(new Blob([String.fromCharCode(0xfeff) + md], { type: "text/markdown;charset=utf-8" }), `${ws.doc.title.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 60) || "lecture"}_notes.md`);
  }

  return (
    <section aria-labelledby="notes-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="notes-title" className="text-sm font-semibold">
          {t("study.notes")}
        </h2>
        <div className="flex flex-wrap gap-2">
          {bookmark ? (
            <Button size="sm" variant="outline" onClick={() => void deleteAnnotation(bookmark.id).catch(fail)}>
              <BookmarkMinus aria-hidden />
              {t("study.removeBookmark")}
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => void addAnnotation({ docId: ws.doc.id, page: ws.page, kind: "bookmark", color: "blue", quote: "", rects: [], note: "" }).catch(fail)}>
              <Bookmark aria-hidden />
              {t("study.bookmarkPage")}
            </Button>
          )}
          {ws.annotations.length > 0 && (
            <Button size="sm" variant="ghost" onClick={exportNotes}>
              <Download aria-hidden />
              {t("study.exportNotes")}
            </Button>
          )}
        </div>
      </div>
      {ws.annotations.length === 0 ? (
        <p className="text-muted-foreground text-sm leading-relaxed">{t("study.noNotes")}</p>
      ) : (
        <ol className="space-y-2">
          {ws.annotations.map((a) => (
            <NoteItem key={a.id} annotation={a} autoFocus={a.id === focusNoteId} />
          ))}
        </ol>
      )}
    </section>
  );
}

function NoteItem({ annotation: a, autoFocus }: { annotation: Annotation; autoFocus: boolean }) {
  const { t } = useI18n();
  const ws = useWorkspace();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saved = useRef(a.note);

  useEffect(() => {
    if (autoFocus) textarea.current?.focus();
  }, [autoFocus]);

  const save = (note: string) => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = null;
    if (note === saved.current) return;
    saved.current = note;
    void updateAnnotation(a.id, { note }).catch(() => {});
  };

  return (
    <li className="rounded-lg border p-2.5">
      <div className="flex items-start gap-2">
        <span aria-hidden className="mt-1 size-3 shrink-0 rounded-full" style={{ background: a.kind === "bookmark" ? "var(--primary)" : HIGHLIGHT_BG[a.color].replace(/\/ 0\.\d+\)/, "/ 1)") }} />
        <div className="min-w-0 flex-1">
          <Button variant="link" size="sm" className="h-auto p-0 text-[13px]" onClick={() => ws.goTo(a.page, a.rects[0])}>
            {a.kind === "bookmark" ? `${t("study.bookmark")} · ${t("study.pageLabel", { n: a.page })}` : t("study.pageLabel", { n: a.page })}
          </Button>
          {a.quote && (
            <p dir="auto" className="mt-0.5 line-clamp-3 text-sm leading-relaxed">
              {a.quote}
            </p>
          )}
        </div>
        <Button size="icon-sm" variant="ghost" aria-label={`${t("study.removeNote")}: ${t("study.pageLabel", { n: a.page })}`} onClick={() => void deleteAnnotation(a.id)}>
          <Trash2 aria-hidden />
        </Button>
      </div>
      <Textarea
        ref={textarea}
        defaultValue={a.note}
        rows={2}
        dir="auto"
        aria-label={t("study.noteFor", { page: a.page })}
        placeholder={t("study.notePlaceholder")}
        onChange={(e) => {
          const value = e.target.value;
          if (pending.current) clearTimeout(pending.current);
          pending.current = setTimeout(() => save(value), 700);
        }}
        onBlur={(e) => save(e.target.value)}
        className="mt-2 min-h-0 resize-y px-2.5 py-1.5 text-sm"
      />
    </li>
  );
}

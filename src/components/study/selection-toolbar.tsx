"use client";

import { BookPlus, Copy, Highlighter, Languages, StickyNote, Volume2 } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { PdfSelection } from "./pdf-viewer";
import { HIGHLIGHT_BG } from "./pdf-viewer";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";
import { HIGHLIGHT_COLORS, type HighlightColor } from "@/lib/study/store";

export type SelectionAction = { type: "translate" } | { type: "listen" } | { type: "highlight"; color: HighlightColor } | { type: "note" } | { type: "glossary" } | { type: "copy" };

/** Actions for text selected on the PDF, shown just above the selection. */
export function SelectionToolbar({ selection, onAction }: { selection: PdfSelection; onAction: (action: SelectionAction) => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Keep the toolbar inside the window, above the selection (below it near the top edge).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.min(window.innerWidth - w - 8, Math.max(8, selection.anchor.x - w / 2));
    const top = selection.anchor.y - h - 10 < 64 ? selection.anchor.y + 28 : selection.anchor.y - h - 10;
    setPos({ left, top });
  }, [selection]);

  // Buttons act on mousedown-safe click without clearing the selection first.
  const keep = (e: React.MouseEvent) => e.preventDefault();
  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={t("study.selection")}
      onMouseDown={keep}
      className="bg-popover text-popover-foreground fixed z-50 flex flex-wrap items-center gap-0.5 rounded-xl border p-1 shadow-lg"
      style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden", left: 0, top: 0 }}
    >
      <Button size="sm" variant="ghost" onClick={() => onAction({ type: "translate" })}>
        <Languages aria-hidden />
        {t("study.translate")}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => onAction({ type: "listen" })}>
        <Volume2 aria-hidden />
        {t("study.listen")}
      </Button>
      <span className="bg-border mx-0.5 h-5 w-px" aria-hidden />
      <Highlighter className="text-muted-foreground mx-1 size-4" aria-hidden />
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className="focus-visible:ring-ring size-6 rounded-full border border-black/10 outline-none focus-visible:ring-2"
          style={{ background: HIGHLIGHT_BG[c].replace(/\/ 0\.\d+\)/, "/ 0.9)") }}
          aria-label={t("study.highlightIn", { color: t(`study.colors.${c}`) })}
          title={t("study.highlightIn", { color: t(`study.colors.${c}`) })}
          onClick={() => onAction({ type: "highlight", color: c })}
        />
      ))}
      <span className="bg-border mx-0.5 h-5 w-px" aria-hidden />
      <Button size="sm" variant="ghost" onClick={() => onAction({ type: "note" })}>
        <StickyNote aria-hidden />
        {t("study.note")}
      </Button>
      <Button size="icon-sm" variant="ghost" onClick={() => onAction({ type: "glossary" })} aria-label={t("study.addToGlossary")} title={t("study.addToGlossary")}>
        <BookPlus aria-hidden />
      </Button>
      <Button size="icon-sm" variant="ghost" onClick={() => onAction({ type: "copy" })} aria-label={t("study.copy")} title={t("study.copy")}>
        <Copy aria-hidden />
      </Button>
    </div>
  );
}

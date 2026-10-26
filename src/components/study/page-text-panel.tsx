"use client";

import { Copy, Crosshair, Highlighter, Languages, Loader2, ScanText, TriangleAlert, Volume2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "./workspace-context";
import { Notice, ProgressBar } from "@/components/studio/primitives";
import { Button } from "@/components/ui/button";
import { OCR_LOW_CONFIDENCE } from "@/lib/files/limits";
import { useI18n } from "@/lib/i18n/provider";
import type { Paragraph } from "@/lib/study/layout";
import { cn } from "@/lib/utils";

/** The current page's text, paragraph by paragraph, linked to the PDF. */
export function PageTextPanel() {
  const { t } = useI18n();
  const ws = useWorkspace();
  const page = ws.pages.find((p) => p.page === ws.page);
  const scanned = ws.doc.scannedPages;
  const running = ws.ocr.running;

  return (
    <section aria-labelledby="page-text-title" className="space-y-3" style={{ fontSize: ws.textSize }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="page-text-title" className="text-sm font-semibold">
          {t("study.pageText", { page: ws.page })}
        </h2>
        {page?.source === "ocr" && page.confidence !== undefined && <span className="text-muted-foreground text-[12px]">{t("study.ocrLabel", { percent: Math.round(page.confidence) })}</span>}
      </div>

      {running && (
        <div role="status" aria-live="polite" className="space-y-2 rounded-lg border p-3 text-sm">
          <p>{t("study.recognizing", { page: running.page, done: running.done, total: running.total })}</p>
          <ProgressBar value={(running.done / Math.max(1, running.total)) * 100} label={t("study.recognize")} />
          <Button size="sm" variant="outline" onClick={ws.ocr.stop}>
            {t("study.stop")}
          </Button>
        </div>
      )}

      {page?.source === "ocr" && page.confidence !== undefined && page.confidence < OCR_LOW_CONFIDENCE && (
        <Notice tone="warning">
          <p>{t("study.ocrLow")}</p>
        </Notice>
      )}

      {!page || page.source === "none" ? (
        <div className="space-y-3">
          <Notice tone="info">
            <p>{scanned.includes(ws.page) ? t("study.noText") : t("study.ocrNothing")}</p>
          </Notice>
          {!running && (
            <div className="flex flex-wrap gap-2">
              {scanned.includes(ws.page) && (
                <Button size="sm" onClick={() => ws.ocr.start([ws.page])}>
                  <ScanText aria-hidden />
                  {t("study.recognize")}
                </Button>
              )}
              {scanned.length > 1 && (
                <Button size="sm" variant="outline" onClick={() => ws.ocr.start(scanned)}>
                  {t("study.recognizeAll", { count: scanned.length })}
                </Button>
              )}
            </div>
          )}
          <p className="text-muted-foreground text-[13px] leading-relaxed">{t("ocr.hint")}</p>
        </div>
      ) : (
        <ol className="space-y-2">
          {page.paragraphs.map((p, i) => (
            <ParagraphItem key={`${ws.page}-${i}`} paragraph={p} index={i} />
          ))}
        </ol>
      )}
    </section>
  );
}

function ParagraphItem({ paragraph, index }: { paragraph: Paragraph; index: number }) {
  const { t } = useI18n();
  const ws = useWorkspace();
  const [translation, setTranslation] = useState<string | "loading" | null>(null);
  const label = `${t(`study.kinds.${paragraph.kind}`)} ${index + 1}`;

  async function translate() {
    setTranslation("loading");
    try {
      setTranslation(await ws.translateText(paragraph.text));
    } catch {
      setTranslation(null);
      toast.error(t("study.translateFailed"));
    }
  }

  return (
    <li className="group hover:bg-accent/40 relative rounded-lg border border-transparent p-2 transition-colors hover:border-border focus-within:border-border">
      <div className="cursor-pointer" onClick={() => ws.focusParagraph(ws.page, paragraph.box)}>
        <ParagraphBody paragraph={paragraph} />
      </div>
      {/* Phones: always shown under the paragraph. Larger screens: floating, on hover or keyboard focus. */}
      <div
        className="mt-1 flex flex-wrap items-center gap-0.5 lg:bg-popover lg:absolute lg:end-1 lg:-top-4 lg:z-10 lg:mt-0 lg:rounded-md lg:border lg:shadow-sm lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100"
        role="group"
        aria-label={label}
      >
        <IconAction icon={Crosshair} label={t("study.showOnPage")} onClick={() => ws.focusParagraph(ws.page, paragraph.box)} />
        <IconAction icon={Volume2} label={t("study.listen")} onClick={() => ws.listen(paragraph.text, t("study.pageText", { page: ws.page }))} />
        {paragraph.kind !== "code" && paragraph.kind !== "math" && <IconAction icon={Languages} label={t("study.translate")} onClick={() => void translate()} />}
        <IconAction icon={Highlighter} label={t("study.highlight")} onClick={() => void ws.highlight(ws.page, [paragraph.box], paragraph.text, "yellow")} />
        <IconAction
          icon={Copy}
          label={t("study.copy")}
          onClick={() =>
            void navigator.clipboard.writeText(paragraph.text).then(
              () => toast.success(t("study.copied")),
              () => {},
            )
          }
        />
      </div>
      {translation && (
        <div className="bg-primary-soft mt-1.5 rounded-md p-2" aria-live="polite">
          {translation === "loading" ? (
            <Loader2 className="text-primary size-4 animate-spin" aria-label={t("study.translate")} />
          ) : (
            <p dir="auto" lang={ws.target} className="leading-relaxed">
              {translation}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function ParagraphBody({ paragraph, className }: { paragraph: Paragraph; className?: string }) {
  switch (paragraph.kind) {
    case "heading":
      return (
        <p dir="auto" className={cn("text-[1.08em] font-semibold", className)}>
          {paragraph.text}
        </p>
      );
    case "code":
    case "math":
    case "table":
      return (
        <pre dir="ltr" className={cn("bg-muted scroll-thin overflow-x-auto rounded-md p-2 font-mono text-[0.88em] leading-relaxed whitespace-pre", paragraph.kind === "math" && "text-center", className)}>
          {paragraph.text}
        </pre>
      );
    default:
      return (
        <p dir="auto" className={cn("leading-relaxed", paragraph.kind === "list" && "ps-3", className)}>
          {paragraph.text}
        </p>
      );
  }
}

export function IconAction({ icon: Icon, label, onClick, disabled }: { icon: typeof Copy; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <Button size="icon-sm" variant="ghost" onClick={onClick} disabled={disabled} aria-label={label} title={label}>
      <Icon aria-hidden />
    </Button>
  );
}

export function OcrUncertainNote() {
  const { t } = useI18n();
  return (
    <Notice tone="warning">
      <p className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t("study.ocrUncertain")}
      </p>
    </Notice>
  );
}

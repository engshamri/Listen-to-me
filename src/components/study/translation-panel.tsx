"use client";

import { AArrowDown, AArrowUp, Download, Languages, Volume2 } from "lucide-react";
import { useMemo, useState } from "react";
import { OcrUncertainNote, ParagraphBody } from "./page-text-panel";
import { TEXT_SIZES, useStudySettings } from "./study-hooks";
import { useWorkspace } from "./workspace-context";
import { ProgressBar } from "@/components/studio/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { downloadBlob } from "@/components/library/library-hooks";
import { parsePageRange } from "@/lib/files/pdf";
import { useI18n } from "@/lib/i18n/provider";
import { translationMarkdown } from "@/lib/study/export";
import { UNTRANSLATED_KINDS } from "@/lib/study/layout";
import { TRANSLATION_LANGUAGES, languageLabel } from "@/lib/translate/languages";

/** Original and translation side by side for the current page, plus page-range and whole-lecture translation. */
export function TranslationPanel() {
  const { t, locale } = useI18n();
  const ws = useWorkspace();
  const [settings, setSettings] = useStudySettings();
  const [range, setRange] = useState("");
  const [rangeOpen, setRangeOpen] = useState(false);
  const page = ws.pages.find((p) => p.page === ws.page);
  const tr = page?.translations?.[ws.target];
  const running = ws.translation.running;
  const languages = useMemo(() => TRANSLATION_LANGUAGES.map((code) => ({ code, label: languageLabel(code, locale) })).sort((a, b) => a.label.localeCompare(b.label, locale)), [locale]);
  const rangePages = range.trim() ? parsePageRange(range, ws.doc.pageCount) : null;
  const translatedCount = ws.pages.filter((p) => p.translations?.[ws.target]).length;

  function exportTranslation() {
    const md = translationMarkdown(ws.doc.title, ws.pages, ws.target, {
      page: (n) => t("study.pageLabel", { n }),
      ocr: (percent) => t("study.ocrLabel", { percent }),
      notTranslated: t("study.notTranslated"),
      bookmark: t("study.bookmark"),
    });
    downloadBlob(new Blob([String.fromCharCode(0xfeff) + md], { type: "text/markdown;charset=utf-8" }), `${ws.doc.title.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 60) || "lecture"}_${ws.target}.md`);
  }

  return (
    <section aria-labelledby="translation-title" className="space-y-3">
      <h2 id="translation-title" className="sr-only">
        {t("study.tabs.translation")}
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="study-target" className="text-[13px] font-medium">
          {t("study.target")}
        </label>
        <select
          id="study-target"
          value={settings.target}
          onChange={(e) => setSettings({ target: e.target.value })}
          className="border-input bg-background h-8 rounded-md border px-2 text-sm"
        >
          {languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
        <span className="ms-auto flex items-center gap-0.5">
          <Button size="icon-sm" variant="ghost" aria-label={t("study.smaller")} disabled={settings.textSize <= 0} onClick={() => setSettings({ textSize: settings.textSize - 1 })}>
            <AArrowDown aria-hidden />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label={t("study.larger")} disabled={settings.textSize >= TEXT_SIZES.length - 1} onClick={() => setSettings({ textSize: settings.textSize + 1 })}>
            <AArrowUp aria-hidden />
          </Button>
        </span>
      </div>

      {running ? (
        <div role="status" aria-live="polite" className="space-y-2 rounded-lg border p-3 text-sm">
          <p>{t("study.translatingProgress", { done: running.done, total: running.total })}</p>
          <ProgressBar value={(running.done / Math.max(1, running.total)) * 100} label={t("study.translateAll")} />
          <Button size="sm" variant="outline" onClick={ws.translation.stop}>
            {t("study.stop")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => ws.translation.translatePages([ws.page])} disabled={!page || page.source === "none"}>
            <Languages aria-hidden />
            {t("study.translatePage")}
          </Button>
          <Popover open={rangeOpen} onOpenChange={setRangeOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline">
                {t("study.translatePages")}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 space-y-2">
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!rangePages?.length) return;
                  ws.translation.translatePages(rangePages);
                  setRangeOpen(false);
                }}
              >
                <label htmlFor="study-range" className="text-sm font-medium">
                  {t("study.pagesLabel")}
                </label>
                <Input id="study-range" value={range} onChange={(e) => setRange(e.target.value)} placeholder={t("study.pagesHint")} dir="ltr" aria-invalid={Boolean(range.trim()) && !rangePages} />
                {range.trim() && !rangePages && <p className="text-destructive text-[13px]">{t("study.pagesInvalid", { max: ws.doc.pageCount })}</p>}
                <Button type="submit" size="sm" disabled={!rangePages?.length} className="w-full">
                  {t("study.translateRange", { count: rangePages?.length ?? 0 })}
                </Button>
              </form>
            </PopoverContent>
          </Popover>
          <Button size="sm" variant="outline" onClick={() => ws.translation.translatePages(Array.from({ length: ws.doc.pageCount }, (_, i) => i + 1))}>
            {t("study.translateAll")}
          </Button>
          {translatedCount > 0 && (
            <Button size="sm" variant="ghost" onClick={exportTranslation}>
              <Download aria-hidden />
              {t("study.exportTranslation")}
            </Button>
          )}
        </div>
      )}

      {page?.source === "ocr" && tr && <OcrUncertainNote />}

      {!page || page.source === "none" ? (
        <p className="text-muted-foreground text-sm">{t("study.noText")}</p>
      ) : !tr ? (
        <p className="text-muted-foreground text-sm">{t("study.pageNotTranslated")}</p>
      ) : (
        <div style={{ fontSize: ws.textSize }}>
          <div className="text-muted-foreground mb-1 grid grid-cols-1 gap-3 text-[12px] font-medium sm:grid-cols-2">
            <span>{t("study.original")}</span>
            <span className="hidden sm:block">{languageLabel(ws.target, locale)}</span>
          </div>
          <ol className="divide-y">
            {page.paragraphs.map((p, i) => {
              const text = tr.paragraphs[i];
              const untranslated = UNTRANSLATED_KINDS.has(p.kind);
              return (
                <li key={i} className="grid grid-cols-1 gap-x-4 gap-y-1.5 py-2.5 sm:grid-cols-2">
                  <div className="cursor-pointer" onClick={() => ws.focusParagraph(ws.page, p.box)}>
                    <ParagraphBody paragraph={p} />
                  </div>
                  <div className="flex items-start gap-1">
                    {untranslated ? (
                      <p className="text-muted-foreground text-[0.85em] italic">{t("study.notTranslated")}</p>
                    ) : (
                      <>
                        <p dir="auto" lang={ws.target} className="min-w-0 flex-1 leading-relaxed">
                          {text}
                        </p>
                        {text && (
                          <Button size="icon-sm" variant="ghost" className="shrink-0" aria-label={`${t("study.listen")}: ${languageLabel(ws.target, locale)} ${i + 1}`} onClick={() => ws.listen(text, t("study.pageText", { page: ws.page }))}>
                            <Volume2 aria-hidden />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="text-muted-foreground mt-2 text-[12px]">{t("study.translatedBy", { provider: tr.provider })}</p>
        </div>
      )}
    </section>
  );
}

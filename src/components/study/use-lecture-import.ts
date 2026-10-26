"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { MAX_PDF_BYTES } from "@/lib/files/limits";
import { PdfError, destroyPdf, openPdf } from "@/lib/files/pdf";
import { useI18n } from "@/lib/i18n/provider";
import type { TKey } from "@/lib/i18n/translate";
import { MAX_STUDY_PAGES, readPages, titleFromFileName, usableTitle } from "@/lib/study/import";
import { createDoc, type StudyDoc } from "@/lib/study/store";

const PDF_ERROR_KEY: Partial<Record<PdfError["code"], TKey>> = {
  NOT_PDF: "pdf.notPdf",
  ENCRYPTED: "pdf.encrypted",
  INVALID: "pdf.invalid",
  TIMEOUT: "pdf.timeout",
};

/** Reads a lecture PDF in the browser and saves it locally; reports page progress and can be cancelled. */
export function useLectureImport(onSaved: (doc: StudyDoc) => void) {
  const { t, fmt } = useI18n();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  async function importFile(file: File, courseId: string | null = null) {
    if (ctrl.current) return;
    if (!/\.pdf$/iu.test(file.name) && file.type !== "application/pdf") return void toast.error(t("pdf.notPdf"));
    if (file.size > MAX_PDF_BYTES) return void toast.error(t("file.tooLarge", { name: file.name, size: fmt.bytes(file.size), max: fmt.bytes(MAX_PDF_BYTES) }));
    const controller = new AbortController();
    ctrl.current = controller;
    setProgress({ done: 0, total: 0 });
    try {
      const doc = await openPdf(await file.arrayBuffer(), controller.signal);
      try {
        if (doc.numPages > MAX_STUDY_PAGES) {
          toast.error(t("study.tooManyPages", { count: doc.numPages, max: MAX_STUDY_PAGES }));
          return;
        }
        setProgress({ done: 0, total: doc.numPages });
        const pages = await readPages(doc, { signal: controller.signal, onProgress: (done, total) => setProgress({ done, total }) });
        const meta = await doc.getMetadata().catch(() => null);
        // The File itself is stored (pdf.js may have taken over the ArrayBuffer it read).
        const saved = await createDoc({
          title: usableTitle((meta?.info as { Title?: unknown } | undefined)?.Title) ?? titleFromFileName(file.name),
          fileName: file.name,
          size: file.size,
          pageCount: doc.numPages,
          courseId,
          file: new Blob([file], { type: "application/pdf" }),
          pages,
        });
        if (navigator.storage?.persist) void navigator.storage.persist().catch(() => {});
        onSaved(saved);
      } finally {
        destroyPdf(doc);
      }
    } catch (e) {
      if (controller.signal.aborted || (e instanceof PdfError && e.code === "ABORTED")) return;
      const key = e instanceof PdfError ? PDF_ERROR_KEY[e.code] : undefined;
      toast.error(key ? t(key) : (e as { name?: string })?.name === "QuotaExceededError" || (e as { code?: string })?.code === "QUOTA" ? t("library.errors.QUOTA") : t("study.saveFailed"));
    } finally {
      ctrl.current = null;
      setProgress(null);
    }
  }

  return { progress, importFile, cancel: () => ctrl.current?.abort() };
}

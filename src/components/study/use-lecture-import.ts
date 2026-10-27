"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { sniffFile } from "@/lib/files/kind";
import { MAX_PDF_BYTES } from "@/lib/files/limits";
import { PdfError, classifyPdfError, destroyPdf, openPdf } from "@/lib/files/pdf";
import { diagnosticReport } from "@/lib/files/pdf-diagnostics";
import { PDF_ERROR_KEYS } from "@/lib/files/pdf-messages";
import { useI18n } from "@/lib/i18n/provider";
import { MAX_STUDY_PAGES, readPages, titleFromFileName, usableTitle } from "@/lib/study/import";
import { createDoc, type StudyDoc } from "@/lib/study/store";

/** Reads a lecture PDF in the browser and saves it locally; reports page progress and can be cancelled. */
export function useLectureImport(onSaved: (doc: StudyDoc) => void) {
  const { t, fmt } = useI18n();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  async function importFile(file: File, courseId: string | null = null) {
    if (ctrl.current) return;
    // Decided from the file's bytes: phones often report no type, or a generic one.
    const kind = await sniffFile(file).catch(() => null);
    if (!kind) return void toast.error(t("file.readFailed"));
    if (kind.kind !== "pdf") return void toast.error(t(kind.kind === null && kind.reason === "UNSUPPORTED" ? "file.unsupported" : "pdf.notPdf"));
    if (file.size > MAX_PDF_BYTES) return void toast.error(t("file.tooLarge", { name: file.name, size: fmt.bytes(file.size), max: fmt.bytes(MAX_PDF_BYTES) }));
    const controller = new AbortController();
    ctrl.current = controller;
    setProgress({ done: 0, total: 0 });
    try {
      const doc = await openPdf(await file.arrayBuffer().catch(() => Promise.reject(new PdfError("READ_FAILED"))), { signal: controller.signal });
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
      if (!(e instanceof PdfError)) {
        // Saving failed (storage), not reading.
        toast.error((e as { name?: string })?.name === "QuotaExceededError" || (e as { code?: string })?.code === "QUOTA" ? t("library.errors.QUOTA") : t("study.saveFailed"));
        return;
      }
      const code = classifyPdfError(e);
      console.warn("[pdf] lecture import failed:", code, e.stage, e.original?.message ?? e.message);
      if (code === "PASSWORD_REQUIRED" || code === "PASSWORD_INCORRECT") return void toast.error(t("study.passwordPdf"), { duration: 12_000 });
      const report = diagnosticReport(e, { action: "Study: add a lecture", fileSize: file.size });
      toast.error(t(PDF_ERROR_KEYS[code], { max: fmt.bytes(MAX_PDF_BYTES) }), {
        duration: 30_000,
        action: { label: t("pdf.copyReport"), onClick: () => void navigator.clipboard.writeText(report).then(() => toast.success(t("pdf.reportCopied")), () => toast.info(report, { duration: 60_000 })) },
      });
    } finally {
      ctrl.current = null;
      setProgress(null);
    }
  }

  return { progress, importFile, cancel: () => ctrl.current?.abort() };
}

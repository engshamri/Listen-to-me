"use client";

import { CheckCircle2, Circle, FileSearch, Loader2, RotateCcw, XCircle } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { BackButton } from "@/components/app/back-button";
import { DiagnosticActions } from "@/components/studio/pdf-diagnostics";
import { Button } from "@/components/ui/button";
import { appBuild, browserFeatures, diagnosticReport } from "@/lib/files/pdf-diagnostics";
import { destroyPdf, extractPdfText, loadPdfJs, openPdf, PdfError, type PdfStage } from "@/lib/files/pdf";
import { useI18n } from "@/lib/i18n/provider";
import type { TKey } from "@/lib/i18n/translate";
import { cn } from "@/lib/utils";

/*
 * PDF check: runs each stage of reading a PDF on a known sample (our own
 * test lecture) and shows which stage passes or fails, so a student can see
 * on their own phone whether this browser can read PDFs here and copy a
 * report. Everything runs on the device. With the student's own file only
 * page and character counts are shown, never its text or name.
 */

const SAMPLE_URL = "/samples/pdf-check.pdf";

type StepId = "reader" | "open" | "page1" | "page5" | "reopen" | "cleanup";
const STEPS: StepId[] = ["reader", "open", "page1", "page5", "reopen", "cleanup"];
const STAGE_OF: Record<StepId, PdfStage> = { reader: "reader", open: "open", page1: "text", page5: "text", reopen: "open", cleanup: "open" };

interface StepResult {
  status: "pending" | "running" | "ok" | "failed" | "skipped";
  detail?: string;
}

const pending = (): Record<StepId, StepResult> => Object.fromEntries(STEPS.map((s) => [s, { status: "pending" }])) as Record<StepId, StepResult>;

export function PdfCheck() {
  const { t } = useI18n();
  const [steps, setSteps] = useState(pending);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState("");
  const [own, setOwn] = useState<{ status: "running" | "ok" | "failed"; lines: string[] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  const run = useCallback(async () => {
    setRunning(true);
    setSteps(pending());
    const results = pending();
    const set = (id: StepId, r: StepResult) => {
      results[id] = r;
      setSteps({ ...results });
    };
    let doc: PDFDocumentProxy | null = null;
    let failure: { id: StepId; error: unknown } | null = null;
    let bytes: ArrayBuffer | null = null;
    const step = async (id: StepId, fn: () => Promise<string>) => {
      if (failure) return set(id, { status: "skipped" });
      set(id, { status: "running" });
      try {
        set(id, { status: "ok", detail: await fn() });
      } catch (e) {
        failure = { id, error: e };
        const err = PdfError.from(e, STAGE_OF[id]);
        set(id, { status: "failed", detail: `${err.code}: ${err.original ? `${err.original.name}: ${err.original.message}` : err.message}` });
      }
    };
    const pageText = async (n: number) => {
      const r = await extractPdfText(doc!, [n]);
      const text = r.pages.get(n) ?? "";
      if (!text) throw new PdfError("NO_TEXT", `page ${n} gave no text`);
      return `${t("pdfCheck.chars", { count: text.length })}: “${text.slice(0, 48)}…”`;
    };

    await step("reader", async () => `pdf.js ${(await loadPdfJs()).version}`);
    await step("open", async () => {
      const res = await fetch(SAMPLE_URL);
      if (!res.ok) throw new PdfError("ASSET_FAILED", `${SAMPLE_URL}: HTTP ${res.status}`);
      bytes = await res.arrayBuffer();
      doc = await openPdf(bytes.slice(0));
      return t("pdf.pages", { count: doc.numPages });
    });
    await step("page1", () => pageText(1));
    await step("page5", () => pageText(5));
    await step("reopen", async () => {
      destroyPdf(doc!);
      doc = await openPdf(bytes!.slice(0));
      return pageText(2);
    });
    await step("cleanup", async () => {
      await doc!.loadingTask.destroy();
      if (!doc!.loadingTask.destroyed) throw new Error("the document was not released");
      doc = null;
      return t("pdfCheck.released");
    });
    if (doc) destroyPdf(doc);

    const summary = STEPS.map((id) => `  ${results[id].status.toUpperCase().padEnd(7)} ${id}${results[id].detail ? ` — ${results[id].detail}` : ""}`);
    const f = failure as { id: StepId; error: unknown } | null;
    const head = f
      ? diagnosticReport(PdfError.from(f.error, STAGE_OF[f.id]), { action: `PDF check: ${f.id}`, documentOpened: f.id !== "reader" && f.id !== "open" })
      : [
          "Listen to me — PDF diagnostic report",
          `Time: ${new Date().toISOString()}`,
          `App build: ${appBuild()}`,
          "Result: all PDF check steps passed",
          `Browser: ${navigator.userAgent}`,
          "Features:",
          ...Object.entries(browserFeatures()).map(([k, v]) => `  ${v ? "yes" : "NO "}  ${k}`),
        ].join("\n");
    setReport(`${head}\nPDF check (sample document):\n${summary.join("\n")}`);
    setRunning(false);
  }, [t]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  async function checkOwnFile(file: File) {
    setOwn({ status: "running", lines: [] });
    const lines: string[] = [];
    let doc: PDFDocumentProxy | null = null;
    try {
      doc = await openPdf(await file.arrayBuffer());
      lines.push(t("pdf.pages", { count: doc.numPages }));
      const last = Math.min(5, doc.numPages);
      const r = await extractPdfText(doc, last > 1 ? [1, last] : [1]);
      for (const [n, text] of r.pages) lines.push(t("pdfCheck.pageChars", { page: n, count: text.length }));
      for (const n of r.failedPages) lines.push(t("pdfCheck.pageFailed", { page: n }));
      setOwn({ status: "ok", lines });
      setReport((rep) => `${rep}\nOwn file: ${(file.size / 1024 / 1024).toFixed(2)} MB, ${doc!.numPages} pages; ${[...r.pages].map(([n, text]) => `page ${n}: ${text.length} characters`).join(", ")}${r.failedPages.length ? `; failed pages ${r.failedPages.join(", ")}` : ""} (no name or text included)`);
    } catch (e) {
      const err = PdfError.from(e, doc ? "text" : "open");
      lines.push(`${err.code}: ${err.original ? `${err.original.name}: ${err.original.message}` : err.message}`);
      setOwn({ status: "failed", lines });
      setReport((rep) => `${rep}\n\nOwn file failed:\n${diagnosticReport(err, { action: "PDF check: own file", fileSize: file.size, pageCount: doc?.numPages, documentOpened: Boolean(doc) })}`);
    } finally {
      if (doc) destroyPdf(doc);
    }
  }

  const failed = STEPS.find((id) => steps[id].status === "failed");
  const allOk = STEPS.every((id) => steps[id].status === "ok");

  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-2xl flex-1 px-4 pt-4 pb-10 outline-none sm:px-6">
      <BackButton />
      <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
        <FileSearch className="text-primary size-7" aria-hidden />
        {t("pdfCheck.title")}
      </h1>
      <p className="text-muted-foreground mt-1 text-[15px] leading-relaxed">{t("pdfCheck.intro")}</p>

      <section aria-labelledby="pdf-check-steps" className="bg-card mt-5 rounded-xl border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="pdf-check-steps" className="font-semibold">
            {t("pdfCheck.sample")}
          </h2>
          <Button size="sm" variant="outline" disabled={running} onClick={() => void run()}>
            {running ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />}
            {t("pdfCheck.again")}
          </Button>
        </div>
        <ol className="mt-3 space-y-2">
          {STEPS.map((id) => {
            const s = steps[id];
            return (
              <li key={id} className="flex items-start gap-2.5 text-sm" data-testid={`pdf-check-${id}`} data-status={s.status}>
                {s.status === "ok" ? (
                  <CheckCircle2 className="text-success mt-0.5 size-4 shrink-0" aria-hidden />
                ) : s.status === "failed" ? (
                  <XCircle className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden />
                ) : s.status === "running" ? (
                  <Loader2 className="text-primary mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />
                ) : (
                  <Circle className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
                )}
                <div className="min-w-0">
                  <p className="font-medium">
                    {t(`pdfCheck.steps.${id}` as TKey)}
                    <span className="sr-only"> — {t(`pdfCheck.status.${s.status}` as TKey)}</span>
                  </p>
                  {s.detail && (
                    <p className={cn("text-[13px] [overflow-wrap:anywhere]", s.status === "failed" ? "text-destructive" : "text-muted-foreground")} dir="auto">
                      {s.detail}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        <p role="status" className={cn("mt-3 text-sm font-medium", failed ? "text-destructive" : allOk ? "text-success" : "text-muted-foreground")}>
          {failed ? t("pdfCheck.failedAt", { step: t(`pdfCheck.steps.${failed}` as TKey) }) : allOk ? t("pdfCheck.allPassed") : running ? t("pdfCheck.running") : ""}
        </p>
      </section>

      <section aria-labelledby="pdf-check-own" className="bg-card mt-4 rounded-xl border p-4">
        <h2 id="pdf-check-own" className="font-semibold">
          {t("pdfCheck.ownTitle")}
        </h2>
        <p className="text-muted-foreground mt-1 text-[13px] leading-relaxed">{t("pdfCheck.ownIntro")}</p>
        <input
          ref={fileInput}
          type="file"
          accept=".pdf,application/pdf,application/octet-stream"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void checkOwnFile(file);
          }}
        />
        <Button size="sm" className="mt-3" disabled={own?.status === "running"} onClick={() => fileInput.current?.click()}>
          {own?.status === "running" && <Loader2 className="animate-spin" aria-hidden />}
          {t("pdfCheck.chooseFile")}
        </Button>
        {own && own.status !== "running" && (
          <ul role="status" className={cn("mt-3 space-y-1 text-sm", own.status === "failed" && "text-destructive")} data-testid="pdf-check-own-result">
            {own.lines.map((l, i) => (
              <li key={i} className="[overflow-wrap:anywhere]">
                {l}
              </li>
            ))}
          </ul>
        )}
      </section>

      {report && (
        <section aria-label={t("pdf.reportLabel")} className="mt-4">
          <DiagnosticActions report={report} showCheckLink={false} />
        </section>
      )}
      <p className="text-muted-foreground mt-4 text-[13px] leading-relaxed">{t("pdfCheck.privacy")}</p>
    </main>
  );
}

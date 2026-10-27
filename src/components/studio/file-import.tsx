"use client";

import { FileText, Loader2, LockKeyhole, ScanText } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { DiagnosticActions } from "./pdf-diagnostics";
import { Notice, ProgressBar } from "./primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { decodeTextFile, TextDecodeError, type TextEncoding } from "@/lib/files/decode-text";
import { pickerAccept, sniffFile, type KindResult } from "@/lib/files/kind";
import { MAX_OCR_PAGES, MAX_PDF_BYTES, MAX_PDF_PAGES_PER_IMPORT, MAX_TEXT_CHARS, MAX_TXT_BYTES } from "@/lib/files/limits";
import { OCR_LANGUAGES, recognizePdfPages, type OcrLanguage, type OcrProgress } from "@/lib/files/ocr";
import {
  destroyPdf,
  extractPdfText,
  formatPageList,
  joinPages,
  openPdf,
  parsePageSelection,
  PdfError,
  westernDigits,
  type PageSelection,
  type PdfErrorCode,
  type PdfExtraction,
} from "@/lib/files/pdf";
import { diagnosticReport } from "@/lib/files/pdf-diagnostics";
import { PDF_ERROR_KEYS, pageSelectionMessage } from "@/lib/files/pdf-messages";
import { useI18n } from "@/lib/i18n/provider";
import type { TKey } from "@/lib/i18n/translate";
import { cn } from "@/lib/utils";

export interface ImportedFile {
  name: string;
  size: number;
  kind: "txt" | "pdf";
  encoding?: TextEncoding;
  confident?: boolean;
  /** Original bytes, kept so a TXT can be re-decoded with another encoding. */
  buffer?: ArrayBuffer;
  pagesLabel?: string;
  /** Number of pages whose text came from OCR. */
  ocrPages?: number;
  /** Text as imported, to know whether the user has edited it since. */
  importedText: string;
  /** Editor text before the import, restored by "remove". */
  previousText: string;
}

interface OpenPdf {
  file: File;
  doc: PDFDocumentProxy;
  numPages: number;
}

/** Text-layer results waiting for a decision about the image-only pages. */
interface Pending extends OpenPdf {
  extraction: PdfExtraction;
  rangeLabel: string;
}

type PdfState =
  | { step: "closed" }
  | { step: "opening"; file: File }
  | { step: "password"; file: File; error?: string }
  | ({ step: "ready"; error?: string; report?: string } & OpenPdf)
  | ({ step: "extracting"; done: number; total: number } & OpenPdf)
  | ({ step: "ocrOffer"; error?: string; report?: string } & Pending)
  | ({ step: "ocr"; progress: OcrProgress } & Pending)
  /** report: the diagnostic report of an unexpected failure (see pdf-diagnostics.ts). */
  | { step: "failed"; file: File; error: string; report?: string };

/** How the pages to extract are chosen. "range" uses two number fields, so no hyphen has to be typed. */
type PageMode = "all" | "single" | "range" | "multiple";
const PAGE_MODES: PageMode[] = ["all", "single", "range", "multiple"];
const MODE_LABELS: Record<PageMode, TKey> = { all: "pdf.allPages", single: "pdf.singlePage", range: "pdf.range", multiple: "pdf.multiple" };

const OCR_LANGUAGE_LABELS: Record<OcrLanguage, TKey> = { "ara+eng": "ocr.langBoth", ara: "ocr.langArabic", eng: "ocr.langEnglish" };

/** Digits only, in any numeral system, written as Western digits (number fields). */
const digitsOnly = (value: string) => westernDigits(value).replace(/\D/gu, "").slice(0, 6);
/** Keeps page numbers in reading order inside Arabic (right-to-left) text. */
const ltr = (s: string) => String.fromCharCode(0x2066) + s + String.fromCharCode(0x2069);

/** Props for fields that take one page number: the numeric keypad is fine there. */
const numberField = { inputMode: "numeric", pattern: "[0-9]*", autoComplete: "off", enterKeyHint: "go", dir: "ltr" } as const;

/**
 * File import logic and the PDF page-selection dialog. Files are read
 * entirely in the browser; nothing is uploaded.
 */
export function useFileImport({ getText, onImport }: { getText: () => string; onImport: (text: string, file: ImportedFile) => void }) {
  const { t, fmt, locale } = useI18n();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pdf, setPdf] = useState<PdfState>({ step: "closed" });
  const [mode, setMode] = useState<PageMode>("all");
  const [single, setSingle] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [multiple, setMultiple] = useState("");
  const [password, setPassword] = useState("");
  const [ocrLang, setOcrLang] = useState<OcrLanguage>("ara+eng");
  const abortRef = useRef<AbortController | null>(null);

  const errorText = useCallback((code: PdfErrorCode) => t(PDF_ERROR_KEYS[code], { max: fmt.bytes(MAX_PDF_BYTES) }), [fmt, t]);

  const closePdf = useCallback(() => {
    const busy = abortRef.current !== null;
    abortRef.current?.abort();
    abortRef.current = null;
    setPassword("");
    setPdf((s) => {
      if ("doc" in s) destroyPdf(s.doc);
      if (busy && (s.step === "opening" || s.step === "extracting" || s.step === "ocr")) toast.info(t("pdf.cancelled"));
      return { step: "closed" };
    });
  }, [t]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /** Opens a PDF (again, with a password when one is given) and moves to page selection. */
  const openPdfFile = useCallback(
    async (file: File, pdfPassword?: string) => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setPdf({ step: "opening", file });
      let buffer: ArrayBuffer;
      try {
        buffer = await file.arrayBuffer();
      } catch (e) {
        if (!ctrl.signal.aborted) {
          const err = PdfError.from(e, "open");
          err.code = "READ_FAILED";
          setPdf({ step: "failed", file, error: errorText("READ_FAILED"), report: diagnosticReport(err, { action: "import PDF: read the chosen file", fileSize: file.size }) });
        }
        abortRef.current = null;
        return;
      }
      try {
        const doc = await openPdf(buffer, { signal: ctrl.signal, password: pdfPassword });
        if (ctrl.signal.aborted) return destroyPdf(doc);
        abortRef.current = null;
        setPassword("");
        const capped = doc.numPages > MAX_PDF_PAGES_PER_IMPORT;
        setMode(capped ? "range" : "all");
        setSingle("");
        setFrom(capped ? "1" : "");
        setTo(capped ? String(MAX_PDF_PAGES_PER_IMPORT) : "");
        setMultiple("");
        setPdf({ step: "ready", file, doc, numPages: doc.numPages });
      } catch (e) {
        if (ctrl.signal.aborted) return;
        abortRef.current = null;
        const err = PdfError.from(e, "open");
        // The underlying error, for diagnosis (never the document's text).
        console.warn("[pdf] open failed:", err.code, err.stage, err.original?.message ?? err.message);
        if (err.code === "PASSWORD_REQUIRED" || err.code === "PASSWORD_INCORRECT") {
          setPdf({ step: "password", file, error: err.code === "PASSWORD_INCORRECT" ? errorText(err.code) : undefined });
        } else {
          setPdf({ step: "failed", file, error: errorText(err.code), report: diagnosticReport(err, { action: "import PDF: open", fileSize: file.size }) });
        }
      }
    },
    [errorText],
  );

  const handleFile = useCallback(
    async (file: File | undefined | null) => {
      if (!file) return;
      // The kind comes from the file's first bytes: phones often report no type, or a generic one.
      let kind: KindResult;
      try {
        kind = await sniffFile(file);
      } catch {
        return void toast.error(t("file.readFailed"));
      }
      if (!kind.kind) return void toast.error(t(kind.reason === "NOT_PDF" ? "pdf.notPdf" : "file.unsupported"));
      const max = kind.kind === "pdf" ? MAX_PDF_BYTES : MAX_TXT_BYTES;
      if (file.size > max) return void toast.error(t("file.tooLarge", { name: file.name, size: fmt.bytes(file.size), max: fmt.bytes(max) }));

      if (kind.kind === "txt") {
        try {
          const buffer = await file.arrayBuffer();
          const decoded = decodeTextFile(buffer);
          if (decoded.text.length > MAX_TEXT_CHARS) {
            return void toast.error(t("file.tooLongText", { name: file.name, count: decoded.text.length, max: MAX_TEXT_CHARS }));
          }
          onImport(decoded.text, {
            name: file.name,
            size: file.size,
            kind: "txt",
            encoding: decoded.encoding,
            confident: decoded.confident,
            buffer,
            importedText: decoded.text,
            previousText: getText(),
          });
          if (decoded.confident) toast.success(t("file.imported", { name: file.name }));
          else toast.warning(t("file.encodingGuess", { encoding: decoded.encoding }), { duration: 10_000 });
        } catch (e) {
          if (e instanceof TextDecodeError) toast.error(e.code === "BINARY" ? t("file.binary") : t("file.empty"));
          else toast.error(t("file.readFailed"));
        }
        return;
      }

      await openPdfFile(file);
    },
    [fmt, getText, onImport, openPdfFile, t],
  );

  const pageList = (pages: number[]) => pages.map((p) => fmt.number(p)).join(locale === "ar" ? "، " : ", ");

  /** The pages the current choice selects, or why it can't be used. */
  function selection(numPages: number): PageSelection {
    switch (mode) {
      case "all":
        return { ok: true, pages: Array.from({ length: numPages }, (_, i) => i + 1) };
      case "single":
        return parsePageSelection(single, numPages);
      case "range":
        if (!from || !to) return { ok: false, error: { code: "EMPTY" } };
        return parsePageSelection(`${from}-${to}`, numPages);
      case "multiple":
        return parsePageSelection(multiple, numPages);
    }
  }

  /**
   * Puts the text into the editor and closes the dialog. Keeps the dialog
   * open with an explanation when the text is too long.
   */
  function finishImport(p: Pending, text: string, notes: { ocrPages?: number; skipped?: number[]; lowConfidence?: number[]; unreadable?: number[] }) {
    const { file, doc, numPages } = p;
    if (text.length > MAX_TEXT_CHARS) {
      setPdf({ step: "ready", file, doc, numPages, error: t("pdf.textTooLong", { count: text.length, max: MAX_TEXT_CHARS }) });
      return;
    }
    onImport(text, {
      name: file.name,
      size: file.size,
      kind: "pdf",
      pagesLabel: t("file.pagesOf", { range: p.rangeLabel, total: numPages }),
      ocrPages: notes.ocrPages,
      importedText: text,
      previousText: getText(),
    });
    toast.success(t("file.imported", { name: file.name }));
    const failed = p.extraction.failedPages;
    if (failed.length) toast.warning(t("pdf.failedPages", { count: failed.length, pages: pageList(failed) }), { duration: 15_000 });
    if (notes.ocrPages) toast.info(t("ocr.done", { count: notes.ocrPages }), { duration: 10_000 });
    if (notes.lowConfidence?.length) toast.warning(t("ocr.lowConfidence", { pages: pageList(notes.lowConfidence) }), { duration: 15_000 });
    if (notes.unreadable?.length) toast.warning(t("ocr.unreadable", { pages: pageList(notes.unreadable) }), { duration: 15_000 });
    if (notes.skipped?.length) toast.warning(t("pdf.emptyPages", { count: notes.skipped.length }), { duration: 10_000 });
    abortRef.current = null;
    destroyPdf(doc);
    setPdf({ step: "closed" });
  }

  async function extract() {
    if (pdf.step !== "ready") return;
    const { file, doc, numPages } = pdf;
    const sel = selection(numPages);
    if (!sel.ok) {
      const [key, params] = pageSelectionMessage(sel.error);
      return setPdf({ ...pdf, error: t(key, params) });
    }
    if (sel.pages.length > MAX_PDF_PAGES_PER_IMPORT) return setPdf({ ...pdf, error: t("pdf.tooManyPages", { max: MAX_PDF_PAGES_PER_IMPORT }) });

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPdf({ step: "extracting", file, doc, numPages, done: 0, total: sel.pages.length });
    try {
      const extraction = await extractPdfText(doc, sel.pages, {
        signal: ctrl.signal,
        onProgress: (done, total) => setPdf((s) => (s.step === "extracting" ? { ...s, done, total } : s)),
      });
      abortRef.current = null;
      const pending: Pending = { file, doc, numPages, extraction, rangeLabel: formatPageList(sel.pages) };
      // Image-only pages are never dropped silently: the user decides between OCR and skipping them.
      if (extraction.emptyPages.length) setPdf({ step: "ocrOffer", ...pending });
      else finishImport(pending, joinPages(extraction.pages), {});
    } catch (e) {
      if (ctrl.signal.aborted) return;
      abortRef.current = null;
      const err = PdfError.from(e, "text");
      console.warn("[pdf] extraction failed:", err.code, err.stage, err.original?.message ?? err.message);
      const report = diagnosticReport(err, { action: "import PDF: extract text", fileSize: file.size, pageCount: numPages, pagesSelected: sel.pages.length, documentOpened: true });
      setPdf({ step: "ready", file, doc, numPages, error: errorText(err.code), report });
    }
  }

  async function runOcr() {
    if (pdf.step !== "ocrOffer") return;
    const { step: _step, error: _error, report: _report, ...pending } = pdf;
    const targets = pending.extraction.emptyPages;
    if (targets.length > MAX_OCR_PAGES) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPdf({ step: "ocr", ...pending, progress: { stage: "loading", done: 0, total: targets.length, page: 0 } });
    try {
      const result = await recognizePdfPages(pending.doc, targets, {
        lang: ocrLang,
        signal: ctrl.signal,
        onProgress: (progress) => setPdf((s) => (s.step === "ocr" ? { ...s, progress } : s)),
      });
      abortRef.current = null;
      const merged = new Map(pending.extraction.pages);
      for (const [page, text] of result.pages) merged.set(page, text);
      const text = joinPages(merged);
      if (!text) return setPdf({ step: "ocrOffer", ...pending, error: t("ocr.nothingFound") });
      finishImport(pending, text, {
        ocrPages: targets.length - result.stillEmpty.length,
        lowConfidence: result.lowConfidence,
        unreadable: result.stillEmpty,
      });
    } catch (e) {
      // Stopping returns to the choice; the document stays open.
      if (ctrl.signal.aborted) return setPdf((s) => (s.step === "ocr" ? { step: "ocrOffer", ...pending } : s));
      abortRef.current = null;
      const err = PdfError.from(e, "ocr");
      console.warn("[pdf] OCR failed:", err.code, err.original?.message ?? err.message);
      const report = diagnosticReport(err, { action: "import PDF: text recognition", fileSize: pending.file.size, pageCount: pending.numPages, pagesSelected: targets.length, documentOpened: true });
      setPdf({ step: "ocrOffer", ...pending, error: errorText(err.code === "UNEXPECTED" ? "OCR_FAILED" : err.code), report });
    }
  }

  function skipImagePages() {
    if (pdf.step !== "ocrOffer") return;
    const { step: _step, error: _error, report: _report, ...pending } = pdf;
    finishImport(pending, joinPages(pending.extraction.pages), { skipped: pending.extraction.emptyPages });
  }

  function choosePages() {
    if (pdf.step !== "ocrOffer") return;
    const { file, doc, numPages } = pdf;
    setMode("multiple");
    setPdf({ step: "ready", file, doc, numPages });
  }

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept=".pdf,.txt,application/pdf,text/plain"
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={(e) => {
        const file = e.target.files?.[0];
        // Cleared at once, so choosing the same file again fires another change.
        e.target.value = "";
        void handleFile(file);
      }}
    />
  );

  const open = pdf.step !== "closed";
  const busy = pdf.step === "opening" || pdf.step === "extracting" || pdf.step === "ocr";
  const sel = pdf.step === "ready" ? selection(pdf.numPages) : null;
  /** A selection problem worth showing while typing (not "nothing entered yet"). */
  const liveError = sel && !sel.ok && sel.error.code !== "EMPTY" ? t(...pageSelectionMessage(sel.error)) : null;
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void extract();
    }
  };

  const dialog = (
    <Dialog open={open} onOpenChange={(o) => !o && closePdf()}>
      <DialogContent closeLabel={t("common.close")} onInteractOutside={(e) => busy && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t("pdf.title")}</DialogTitle>
          <DialogDescription>{t("pdf.description")}</DialogDescription>
        </DialogHeader>

        {pdf.step !== "closed" && (
          <div className="bg-muted flex min-w-0 items-center gap-3 rounded-lg p-3">
            <FileText className="text-muted-foreground size-5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-medium [overflow-wrap:anywhere]" dir="auto" data-testid="pdf-file-name">
                {pdf.file.name}
              </p>
              <p className="text-muted-foreground text-[13px]">
                {fmt.bytes(pdf.file.size)}
                {"numPages" in pdf && <> · {t("pdf.pages", { count: pdf.numPages })}</>}
              </p>
            </div>
          </div>
        )}

        {pdf.step === "opening" && (
          <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden /> {t("pdf.opening")}
          </p>
        )}

        {pdf.step === "failed" && (
          <div>
            <Notice tone="error" role="alert">
              {pdf.error}
            </Notice>
            {pdf.report && <DiagnosticActions report={pdf.report} />}
          </div>
        )}

        {pdf.step === "password" && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (password) void openPdfFile(pdf.file, password);
            }}
          >
            <Notice tone={pdf.error ? "error" : "info"} role={pdf.error ? "alert" : undefined} className="flex gap-2">
              <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{pdf.error ?? t("pdf.passwordRequired")}</span>
            </Notice>
            <div>
              <label htmlFor={`${id}-password`} className="text-sm font-medium">
                {t("pdf.password")}
              </label>
              <Input
                id={`${id}-password`}
                type="password"
                autoComplete="off"
                autoFocus
                enterKeyHint="go"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={Boolean(pdf.error) || undefined}
                className="mt-1"
              />
            </div>
            <Button type="submit" disabled={!password}>
              {t("pdf.unlock")}
            </Button>
          </form>
        )}

        {pdf.step === "ready" && (
          <fieldset className="min-w-0 space-y-1">
            <legend className="mb-1 text-sm font-medium">{t("pdf.choosePages")}</legend>
            {PAGE_MODES.map((m) => (
              <div key={m}>
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    type="radio"
                    name={`${id}-pages`}
                    className="accent-primary size-4 shrink-0"
                    checked={mode === m}
                    disabled={m === "all" && pdf.numPages > MAX_PDF_PAGES_PER_IMPORT}
                    onChange={() => {
                      setMode(m);
                      if (pdf.error) setPdf({ ...pdf, error: undefined });
                    }}
                  />
                  <span>
                    {t(MODE_LABELS[m])}
                    {m === "all" && <span className="text-muted-foreground"> ({t("pdf.pages", { count: pdf.numPages })})</span>}
                  </span>
                </label>
                {mode === m && m === "single" && (
                  <div className="ps-7 pb-2">
                    <label htmlFor={`${id}-single`} className="text-muted-foreground text-[13px]">
                      {t("pdf.page")}
                    </label>
                    <Input id={`${id}-single`} {...numberField} autoFocus value={single} onChange={(e) => setSingle(digitsOnly(e.target.value))} onKeyDown={onEnter} aria-invalid={Boolean(liveError) || undefined} className="mt-1 w-28 text-center" />
                  </div>
                )}
                {mode === m && m === "range" && (
                  <div className="flex flex-wrap items-end gap-3 ps-7 pb-2">
                    <div>
                      <label htmlFor={`${id}-from`} className="text-muted-foreground text-[13px]">
                        {t("pdf.fromPage")}
                      </label>
                      <Input id={`${id}-from`} {...numberField} autoFocus={!from} value={from} onChange={(e) => setFrom(digitsOnly(e.target.value))} onKeyDown={onEnter} aria-invalid={Boolean(liveError) || undefined} className="mt-1 w-28 text-center" />
                    </div>
                    <div>
                      <label htmlFor={`${id}-to`} className="text-muted-foreground text-[13px]">
                        {t("pdf.toPage")}
                      </label>
                      <Input id={`${id}-to`} {...numberField} value={to} onChange={(e) => setTo(digitsOnly(e.target.value))} onKeyDown={onEnter} aria-invalid={Boolean(liveError) || undefined} className="mt-1 w-28 text-center" />
                    </div>
                  </div>
                )}
                {mode === m && m === "multiple" && (
                  <div className="ps-7 pb-2">
                    <label htmlFor={`${id}-multiple`} className="text-muted-foreground text-[13px]">
                      {t("pdf.pagesField")}
                    </label>
                    {/* A text keyboard: the numeric keypad on iPhone has no hyphen or comma. */}
                    <Input
                      id={`${id}-multiple`}
                      type="text"
                      inputMode="text"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      enterKeyHint="go"
                      dir="ltr"
                      autoFocus
                      value={multiple}
                      placeholder="1-5, 8, 12-20"
                      onChange={(e) => setMultiple(e.target.value.slice(0, 200))}
                      onKeyDown={onEnter}
                      aria-describedby={`${id}-hint`}
                      aria-invalid={Boolean(liveError) || undefined}
                      className="mt-1"
                    />
                    <p id={`${id}-hint`} className="text-muted-foreground mt-1.5 text-[13px]">
                      {t("pdf.rangeHint")}
                    </p>
                  </div>
                )}
              </div>
            ))}
            <p role="status" className={cn("min-h-5 pt-1 text-[13px]", liveError ? "text-destructive" : "text-muted-foreground")}>
              {liveError ?? (sel?.ok ? t("pdf.selected", { count: sel.pages.length, list: locale === "ar" ? ltr(formatPageList(sel.pages, "، ")) : formatPageList(sel.pages) }) : "")}
            </p>
            {pdf.error && (
              <Notice tone="error" role="alert">
                {pdf.error}
              </Notice>
            )}
            {pdf.error && pdf.report && <DiagnosticActions report={pdf.report} />}
          </fieldset>
        )}

        {pdf.step === "extracting" && (
          <div className="space-y-2" role="status">
            <p className="text-sm">{t("pdf.extracting", { done: pdf.done, total: pdf.total })}</p>
            <ProgressBar value={(pdf.done / pdf.total) * 100} label={t("pdf.title")} valueText={t("pdf.extracting", { done: pdf.done, total: pdf.total })} />
          </div>
        )}

        {pdf.step === "ocrOffer" && (
          <div className="space-y-3">
            <Notice tone="warning">
              {pdf.extraction.emptyPages.length === pdf.extraction.pages.size
                ? t("pdf.noText")
                : t("ocr.someScanned", { count: pdf.extraction.emptyPages.length, pages: pageList(pdf.extraction.emptyPages) })}
            </Notice>
            {pdf.extraction.emptyPages.length > MAX_OCR_PAGES ? (
              <Notice tone="error" role="alert">
                {t("ocr.tooManyPages", { count: pdf.extraction.emptyPages.length, max: MAX_OCR_PAGES })}
              </Notice>
            ) : (
              <>
                <label className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                  <span className="font-medium">{t("ocr.language")}</span>
                  <select
                    value={ocrLang}
                    onChange={(e) => setOcrLang(e.target.value as OcrLanguage)}
                    className="border-input bg-card text-foreground h-10 rounded-lg border px-2.5 text-base outline-none focus-visible:border-ring md:pointer-fine:h-9 md:pointer-fine:text-sm"
                  >
                    {OCR_LANGUAGES.map((l) => (
                      <option key={l} value={l}>
                        {t(OCR_LANGUAGE_LABELS[l])}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-muted-foreground text-[13px] leading-relaxed">{t("ocr.hint")}</p>
              </>
            )}
            {pdf.error && (
              <Notice tone="error" role="alert">
                {pdf.error}
              </Notice>
            )}
            {pdf.error && pdf.report && <DiagnosticActions report={pdf.report} />}
          </div>
        )}

        {pdf.step === "ocr" && (
          <div className="space-y-2" role="status">
            <p className="text-sm">
              {pdf.progress.stage === "loading" ? t("ocr.loading") : t("ocr.recognizing", { done: Math.min(pdf.progress.done + 1, pdf.progress.total), total: pdf.progress.total })}
            </p>
            <ProgressBar
              value={pdf.progress.stage === "loading" ? null : ((pdf.progress.done + pdf.progress.page) / pdf.progress.total) * 100}
              label={t("ocr.title")}
              valueText={t("ocr.recognizing", { done: Math.min(pdf.progress.done + 1, pdf.progress.total), total: pdf.progress.total })}
            />
          </div>
        )}

        <DialogFooter>
          {pdf.step === "ocr" ? (
            <Button variant="outline" onClick={() => abortRef.current?.abort()}>
              {t("ocr.stop")}
            </Button>
          ) : (
            <Button variant="outline" onClick={closePdf}>
              {t("pdf.cancel")}
            </Button>
          )}
          {pdf.step === "failed" && <Button onClick={() => void openPdfFile(pdf.file)}>{t("common.retry")}</Button>}
          {(pdf.step === "ready" || pdf.step === "extracting") && (
            <Button onClick={() => void extract()} disabled={pdf.step === "extracting"}>
              {pdf.step === "extracting" && <Loader2 className="animate-spin" aria-hidden />}
              {t("pdf.extract")}
            </Button>
          )}
          {pdf.step === "ocrOffer" && pdf.extraction.emptyPages.length < pdf.extraction.pages.size && (
            <Button variant="outline" onClick={skipImagePages}>
              {t("ocr.skip", { count: pdf.extraction.emptyPages.length })}
            </Button>
          )}
          {pdf.step === "ocrOffer" &&
            (pdf.extraction.emptyPages.length > MAX_OCR_PAGES ? (
              <Button onClick={choosePages}>{t("ocr.choosePages")}</Button>
            ) : (
              <Button onClick={() => void runOcr()}>
                <ScanText aria-hidden />
                {t("ocr.start", { count: pdf.extraction.emptyPages.length })}
              </Button>
            ))}
          {pdf.step === "ocr" && (
            <Button disabled>
              <Loader2 className="animate-spin" aria-hidden />
              {t("ocr.start", { count: pdf.progress.total })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return {
    openPicker: () => {
      const input = inputRef.current;
      if (!input) return;
      // Touch devices also accept generic file types (see pickerAccept); desktop keeps the strict filter.
      input.accept = pickerAccept();
      input.click();
    },
    handleFile,
    elements: (
      <>
        {fileInput}
        {dialog}
      </>
    ),
  };
}

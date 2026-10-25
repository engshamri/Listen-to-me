"use client";

import { FileText, Loader2, ScanText } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Notice, ProgressBar } from "./primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { decodeTextFile, TextDecodeError, type TextEncoding } from "@/lib/files/decode-text";
import { ACCEPTED_FILE_TYPES, MAX_OCR_PAGES, MAX_PDF_BYTES, MAX_PDF_PAGES_PER_IMPORT, MAX_TEXT_CHARS, MAX_TXT_BYTES } from "@/lib/files/limits";
import { OCR_LANGUAGES, recognizePdfPages, type OcrLanguage, type OcrProgress } from "@/lib/files/ocr";
import { destroyPdf, extractPdfText, joinPages, openPdf, parsePageRange, PdfError, type PdfExtraction } from "@/lib/files/pdf";
import { useI18n } from "@/lib/i18n/provider";
import type { TKey } from "@/lib/i18n/translate";

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
  | ({ step: "ready"; error?: string } & OpenPdf)
  | ({ step: "extracting"; done: number; total: number } & OpenPdf)
  | ({ step: "ocrOffer"; error?: string } & Pending)
  | ({ step: "ocr"; progress: OcrProgress } & Pending)
  | { step: "failed"; file: File; error: string };

const PDF_ERRORS: Record<string, TKey> = {
  NOT_PDF: "pdf.notPdf",
  TOO_LARGE: "pdf.invalid",
  ENCRYPTED: "pdf.encrypted",
  INVALID: "pdf.invalid",
  NO_TEXT: "pdf.noText",
  TIMEOUT: "pdf.timeout",
  OCR_FAILED: "ocr.failed",
};

const OCR_LANGUAGE_LABELS: Record<OcrLanguage, TKey> = { "ara+eng": "ocr.langBoth", ara: "ocr.langArabic", eng: "ocr.langEnglish" };

function kindOf(file: File): "txt" | "pdf" | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (name.endsWith(".txt") || file.type === "text/plain") return "txt";
  return null;
}

/**
 * File import logic and the PDF page-selection dialog. Files are read
 * entirely in the browser; nothing is uploaded.
 */
export function useFileImport({ getText, onImport }: { getText: () => string; onImport: (text: string, file: ImportedFile) => void }) {
  const { t, fmt, locale } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pdf, setPdf] = useState<PdfState>({ step: "closed" });
  const [mode, setMode] = useState<"all" | "range">("all");
  const [range, setRange] = useState("");
  const [ocrLang, setOcrLang] = useState<OcrLanguage>("ara+eng");
  const abortRef = useRef<AbortController | null>(null);

  const closePdf = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPdf((s) => {
      if ("doc" in s) destroyPdf(s.doc);
      return { step: "closed" };
    });
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const handleFile = useCallback(
    async (file: File | undefined | null) => {
      if (!file) return;
      const kind = kindOf(file);
      if (!kind) return void toast.error(t("file.unsupported"));
      const max = kind === "pdf" ? MAX_PDF_BYTES : MAX_TXT_BYTES;
      if (file.size > max) return void toast.error(t("file.tooLarge", { name: file.name, size: fmt.bytes(file.size), max: fmt.bytes(max) }));

      if (kind === "txt") {
        try {
          const buffer = await file.arrayBuffer();
          const decoded = decodeTextFile(buffer);
          if (decoded.text.length > MAX_TEXT_CHARS) {
            return void toast.error(t("file.tooLongText", { name: file.name, count: decoded.text.length, max: MAX_TEXT_CHARS }));
          }
          onImport(decoded.text, {
            name: file.name,
            size: file.size,
            kind,
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

      // PDF: open it, then let the user pick pages.
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setMode("all");
      setRange("");
      setPdf({ step: "opening", file });
      try {
        const doc = await openPdf(await file.arrayBuffer(), ctrl.signal);
        if (ctrl.signal.aborted) return destroyPdf(doc);
        setPdf({ step: "ready", file, doc, numPages: doc.numPages });
        if (doc.numPages > MAX_PDF_PAGES_PER_IMPORT) {
          setMode("range");
          setRange(`1-${MAX_PDF_PAGES_PER_IMPORT}`);
        }
      } catch (e) {
        if (ctrl.signal.aborted) return;
        const code = e instanceof PdfError ? e.code : "INVALID";
        setPdf({ step: "failed", file, error: t(PDF_ERRORS[code] ?? "pdf.invalid") });
      }
    },
    [fmt, getText, onImport, t],
  );

  const pageList = (pages: number[]) => pages.map((p) => fmt.number(p)).join(locale === "ar" ? "، " : ", ");

  /**
   * Puts the text into the editor and closes the dialog. Returns false (and
   * keeps the dialog open with an explanation) when the text is too long.
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
    const pages = mode === "all" ? Array.from({ length: numPages }, (_, i) => i + 1) : parsePageRange(range, numPages);
    if (!pages) return setPdf({ ...pdf, error: t("pdf.rangeInvalid", { max: numPages }) });
    if (pages.length > MAX_PDF_PAGES_PER_IMPORT) return setPdf({ ...pdf, error: t("pdf.tooManyPages", { max: MAX_PDF_PAGES_PER_IMPORT }) });

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPdf({ step: "extracting", file, doc, numPages, done: 0, total: pages.length });
    try {
      const extraction = await extractPdfText(doc, pages, {
        signal: ctrl.signal,
        onProgress: (done, total) => setPdf((s) => (s.step === "extracting" ? { ...s, done, total } : s)),
      });
      const pending: Pending = { file, doc, numPages, extraction, rangeLabel: mode === "all" ? `1-${numPages}` : range.trim() };
      // Image-only pages are never dropped silently: the user decides between OCR and skipping them.
      if (extraction.emptyPages.length) setPdf({ step: "ocrOffer", ...pending });
      else finishImport(pending, joinPages(extraction.pages), {});
    } catch (e) {
      if (ctrl.signal.aborted) return;
      const code = e instanceof PdfError ? e.code : "INVALID";
      setPdf({ step: "ready", file, doc, numPages, error: t(PDF_ERRORS[code] ?? "pdf.invalid") });
    }
  }

  async function runOcr() {
    if (pdf.step !== "ocrOffer") return;
    const { step: _step, error: _error, ...pending } = pdf;
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
      const code = e instanceof PdfError ? e.code : "OCR_FAILED";
      setPdf({ step: "ocrOffer", ...pending, error: t(PDF_ERRORS[code] ?? "ocr.failed") });
    }
  }

  function skipImagePages() {
    if (pdf.step !== "ocrOffer") return;
    const { step: _step, error: _error, ...pending } = pdf;
    finishImport(pending, joinPages(pending.extraction.pages), { skipped: pending.extraction.emptyPages });
  }

  function choosePages() {
    if (pdf.step !== "ocrOffer") return;
    const { file, doc, numPages } = pdf;
    setMode("range");
    setPdf({ step: "ready", file, doc, numPages });
  }

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPTED_FILE_TYPES}
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={(e) => {
        void handleFile(e.target.files?.[0]);
        e.target.value = "";
      }}
    />
  );

  const open = pdf.step !== "closed";
  const busy = pdf.step === "opening" || pdf.step === "extracting" || pdf.step === "ocr";
  const dialog = (
    <Dialog open={open} onOpenChange={(o) => !o && closePdf()}>
      <DialogContent closeLabel={t("common.close")} onInteractOutside={(e) => busy && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t("pdf.title")}</DialogTitle>
          <DialogDescription>{t("pdf.description")}</DialogDescription>
        </DialogHeader>

        {pdf.step !== "closed" && (
          <div className="bg-muted flex items-center gap-3 rounded-lg p-3">
            <FileText className="text-muted-foreground size-5 shrink-0" aria-hidden />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium" dir="auto">{pdf.file.name}</p>
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
          <Notice tone="error" role="alert">
            {pdf.error}
          </Notice>
        )}

        {pdf.step === "ready" && (
          <fieldset className="space-y-3">
            <legend className="sr-only">{t("pdf.range")}</legend>
            <label className="flex items-center gap-3 text-sm">
              <input
                type="radio"
                name="pdf-pages"
                className="accent-primary size-4"
                checked={mode === "all"}
                disabled={pdf.numPages > MAX_PDF_PAGES_PER_IMPORT}
                onChange={() => setMode("all")}
              />
              {t("pdf.allPages")} ({t("pdf.pages", { count: pdf.numPages })})
            </label>
            <label className="flex items-center gap-3 text-sm">
              <input type="radio" name="pdf-pages" className="accent-primary size-4" checked={mode === "range"} onChange={() => setMode("range")} />
              {t("pdf.range")}
            </label>
            {mode === "range" && (
              <div className="ps-7">
                <Input
                  value={range}
                  onChange={(e) => setRange(e.target.value)}
                  placeholder={t("pdf.rangeHint")}
                  aria-label={t("pdf.range")}
                  aria-describedby="pdf-range-hint"
                  dir="ltr"
                  inputMode="numeric"
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && void extract()}
                />
                <p id="pdf-range-hint" className="text-muted-foreground mt-1.5 text-[13px]">
                  {t("pdf.rangeHint")}
                </p>
              </div>
            )}
            {pdf.error && (
              <Notice tone="error" role="alert">
                {pdf.error}
              </Notice>
            )}
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
                    className="border-input bg-card text-foreground h-9 rounded-lg border px-2.5 text-sm outline-none focus-visible:border-ring"
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
    openPicker: () => inputRef.current?.click(),
    handleFile,
    elements: (
      <>
        {fileInput}
        {dialog}
      </>
    ),
  };
}

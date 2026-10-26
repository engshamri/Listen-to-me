/**
 * OCR for scanned (image-only) PDF pages, entirely in the browser.
 *
 * Each page is rendered to a canvas with pdf.js and read by Tesseract
 * (tesseract.js, WebAssembly) in a web worker. The engine and its Arabic and
 * English language data are served by this app from /public/ocr (copied there
 * by scripts/copy-vendor-assets.mjs), so the document never leaves the device
 * and no third-party server is contacted.
 */
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import type { Worker as TesseractWorker } from "tesseract.js";
import { OCR_LOW_CONFIDENCE, OCR_MAX_CANVAS_SIDE, OCR_PAGE_TIMEOUT_MS, OCR_RENDER_SCALE } from "./limits";
import { PdfError, isBlankText, withTimeout, type PageTexts } from "./pdf";

/** Language data shipped with the app (see scripts/copy-vendor-assets.mjs). */
export const OCR_LANGUAGES = ["ara+eng", "ara", "eng"] as const;
export type OcrLanguage = (typeof OCR_LANGUAGES)[number];

export type OcrStage = "loading" | "recognizing";

export interface OcrProgress {
  stage: OcrStage;
  /** Pages finished so far. */
  done: number;
  total: number;
  /** 0..1 progress within the current page. */
  page: number;
}

/** A recognized paragraph and where it is on the page ([left, top, width, height] as fractions). */
export interface OcrParagraph {
  text: string;
  box: [number, number, number, number];
  confidence: number;
}

export interface OcrResult {
  pages: PageTexts;
  /** Pages whose recognition confidence was low: the text needs proofreading. */
  lowConfidence: number[];
  /** Pages where nothing readable was recognized. */
  stillEmpty: number[];
  /** With `paragraphs: true`: each page's paragraphs and its mean confidence (0–100). */
  paragraphs?: Map<number, { paragraphs: OcrParagraph[]; confidence: number }>;
}

const LSTM_ONLY = 1;

/** Normalizes line endings, trailing spaces, repeated spaces and runs of blank lines in OCR output. */
export function tidyOcrText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function abortable<T>(p: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return p;
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new PdfError("ABORTED"));
    const onAbort = () => reject(new PdfError("ABORTED"));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function renderPage(doc: PDFDocumentProxy, pageNo: number, signal?: AbortSignal): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(OCR_RENDER_SCALE, OCR_MAX_CANVAS_SIDE / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const task = page.render({ canvas, viewport, background: "#ffffff" });
  const onAbort = () => task.cancel();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    await task.promise;
  } catch (e) {
    releaseCanvas(canvas);
    if (signal?.aborted) throw new PdfError("ABORTED");
    throw new PdfError("INVALID", (e as Error)?.message);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    page.cleanup();
  }
  return canvas;
}

function releaseCanvas(canvas: HTMLCanvasElement) {
  // Frees the bitmap now instead of waiting for garbage collection.
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * Recognizes the text of `pages`. Pages are processed one at a time so memory
 * stays bounded; cancelling stops the worker immediately.
 */
export async function recognizePdfPages(
  doc: PDFDocumentProxy,
  pages: number[],
  { lang, signal, onProgress, paragraphs: withParagraphs = false }: { lang: OcrLanguage; signal?: AbortSignal; onProgress?: (p: OcrProgress) => void; paragraphs?: boolean },
): Promise<OcrResult> {
  const origin = window.location.origin;
  let current = { done: 0, total: pages.length };
  onProgress?.({ stage: "loading", ...current, page: 0 });

  const { createWorker } = await import("tesseract.js");
  let worker: TesseractWorker | null = null;
  const stop = () => void worker?.terminate().catch(() => {});
  signal?.addEventListener("abort", stop, { once: true });

  try {
    worker = await abortable(
      createWorker(lang.split("+"), LSTM_ONLY, {
        workerPath: `${origin}/ocr/worker.min.js`,
        corePath: `${origin}/ocr/core`,
        langPath: `${origin}/ocr/lang`,
        gzip: true,
        // Served by this app with normal HTTP caching; don't keep a second copy in IndexedDB.
        cacheMethod: "none",
        logger: (m) => {
          if (m.status === "recognizing text") onProgress?.({ stage: "recognizing", ...current, page: m.progress });
        },
      }),
      signal,
    );

    const texts: PageTexts = new Map();
    const lowConfidence: number[] = [];
    const stillEmpty: number[] = [];
    const paragraphs = new Map<number, { paragraphs: OcrParagraph[]; confidence: number }>();
    for (let i = 0; i < pages.length; i++) {
      const pageNo = pages[i];
      current = { done: i, total: pages.length };
      onProgress?.({ stage: "recognizing", ...current, page: 0 });
      const canvas = await withTimeout(renderPage(doc, pageNo, signal), OCR_PAGE_TIMEOUT_MS);
      try {
        const w = worker;
        const { data } = await withTimeout(abortable(w.recognize(canvas, {}, withParagraphs ? { text: true, blocks: true } : undefined), signal), OCR_PAGE_TIMEOUT_MS, stop);
        const text = tidyOcrText(data.text ?? "");
        if (withParagraphs) {
          const W = canvas.width || 1;
          const H = canvas.height || 1;
          const found = (data.blocks ?? [])
            .flatMap((b) => b.paragraphs)
            .map((p) => ({
              // Wrapped lines become one paragraph; a word hyphenated at a line end is rejoined.
              text: tidyOcrText(p.text).replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2").replace(/\s*\n\s*/gu, " "),
              box: [p.bbox.x0 / W, p.bbox.y0 / H, (p.bbox.x1 - p.bbox.x0) / W, (p.bbox.y1 - p.bbox.y0) / H] as OcrParagraph["box"],
              confidence: p.confidence,
            }))
            .filter((p) => !isBlankText(p.text));
          paragraphs.set(pageNo, { paragraphs: found, confidence: data.confidence });
        }
        if (isBlankText(text)) {
          stillEmpty.push(pageNo);
          texts.set(pageNo, "");
        } else {
          texts.set(pageNo, text);
          if (data.confidence < OCR_LOW_CONFIDENCE) lowConfidence.push(pageNo);
        }
      } finally {
        releaseCanvas(canvas);
      }
    }
    onProgress?.({ stage: "recognizing", done: pages.length, total: pages.length, page: 1 });
    return { pages: texts, lowConfidence, stillEmpty, ...(withParagraphs ? { paragraphs } : {}) };
  } catch (e) {
    if (signal?.aborted) throw new PdfError("ABORTED");
    if (e instanceof PdfError) throw e;
    throw new PdfError("OCR_FAILED", (e as Error)?.message ?? String(e));
  } finally {
    signal?.removeEventListener("abort", stop);
    stop();
  }
}

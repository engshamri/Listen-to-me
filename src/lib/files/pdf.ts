/**
 * In-browser PDF text extraction with pdf.js. Documents never leave the
 * user's device. Runs pdf.js in its web worker, so the UI stays responsive.
 */
import type { PDFDocumentProxy, PDFPageProxy, TextContent, TextItem } from "pdfjs-dist/types/src/display/api";
import { arabicLetters } from "@/lib/text/arabic-letters";
import { MAX_PDF_BYTES, PDF_PAGE_TIMEOUT_MS } from "./limits";

export type PdfErrorCode =
  | "NOT_PDF"
  | "TOO_LARGE"
  /** The PDF has a password and none (or the wrong one) was given. */
  | "PASSWORD_REQUIRED"
  | "PASSWORD_INCORRECT"
  /** The file's structure is broken: not readable as a PDF. */
  | "INVALID"
  /** pdf.js read the file but failed on something in it. */
  | "UNSUPPORTED_FEATURE"
  /** A JavaScript built-in or browser API the reader uses is missing. */
  | "UNSUPPORTED_BROWSER"
  /** The pdf.js library or its worker could not be loaded. */
  | "READER_FAILED"
  /** A data file pdf.js asked for (character map, font, decoder) didn't load. */
  | "ASSET_FAILED"
  | "MEMORY"
  /** The browser could not read the chosen file (e.g. a cloud file not downloaded). */
  | "READ_FAILED"
  | "NO_TEXT"
  | "TIMEOUT"
  | "ABORTED"
  | "OCR_FAILED"
  /** Text recognition can't run here: the browser has no WebAssembly (e.g. Lockdown Mode). */
  | "OCR_UNAVAILABLE"
  /** The OCR engine failed to start, or didn't start in time. */
  | "OCR_ENGINE_FAILED"
  /** No selected page could be read. */
  | "EXTRACT_FAILED"
  | "UNEXPECTED";

/** Where reading a PDF failed (for the diagnostic report). */
export type PdfStage = "reader" | "open" | "page" | "text" | "ocr";

export class PdfError extends Error {
  /** Where it failed. */
  stage?: PdfStage;
  /** The underlying exception: name, message and the first lines of its stack. Never document text. */
  original?: { name: string; message: string; stack: string };

  constructor(
    public code: PdfErrorCode,
    message?: string,
  ) {
    super(message ?? code);
  }

  /** Wraps any failure at a stage, keeping the original exception for the diagnostic report. */
  static from(e: unknown, stage: PdfStage): PdfError {
    if (e instanceof PdfError) {
      e.stage ??= stage;
      return e;
    }
    const err = new PdfError(classifyPdfError(e), (e as Error)?.message);
    err.stage = stage;
    err.original = {
      name: String((e as { name?: unknown } | null)?.name ?? typeof e),
      message: String((e as { message?: unknown } | null)?.message ?? e).slice(0, 300),
      stack: String((e as { stack?: unknown } | null)?.stack ?? "")
        .split("\n")
        .slice(0, 6)
        .join("\n"),
    };
    return err;
  }
}

/** Sorts any failure while opening or reading a PDF into a code the interface can explain. */
export function classifyPdfError(e: unknown): PdfErrorCode {
  if (e instanceof PdfError) return e.code;
  const name = String((e as { name?: unknown } | null)?.name ?? "");
  const message = String((e as { message?: unknown } | null)?.message ?? "");
  if (name === "PasswordException") return (e as { code?: number }).code === 2 ? "PASSWORD_INCORRECT" : "PASSWORD_REQUIRED";
  if (name === "InvalidPDFException") return "INVALID";
  if (/fake worker|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk/iu.test(`${name} ${message}`)) return "READER_FAILED";
  if (/Unable to load (binary )?CMap|standard font|Unable to load (wasm|the WebAssembly)|wasm.*(fetch|load)/iu.test(message)) return "ASSET_FAILED";
  if (name === "RangeError" || /out of memory|allocation failed|Array buffer allocation|Maximum call stack/iu.test(message)) return "MEMORY";
  // A built-in or API this browser lacks, e.g. "undefined is not a function (near '...t of e...')".
  if (["TypeError", "ReferenceError", "SyntaxError"].includes(name) || /is not a function|is not defined|Can't find variable|is not a constructor|undefined is not an object/iu.test(message)) {
    return "UNSUPPORTED_BROWSER";
  }
  if (["UnknownErrorException", "FormatError", "UnexpectedResponseException", "ResponseException"].includes(name)) return "UNSUPPORTED_FEATURE";
  return "UNEXPECTED";
}

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjsPromise: Promise<PdfJs> | null = null;
let pdfjsInfo: { version: string; workerSrc: string } | null = null;

/** Where the copied pdf.js files are served (see scripts/copy-vendor-assets.mjs). */
const PDFJS_BASE = "/pdfjs";

/**
 * Loads pdf.js once. The legacy build is used on purpose: the modern build
 * calls the newest JavaScript built-ins without fallbacks (Uint8Array#toHex,
 * Map#getOrInsertComputed, Math.sumPrecise…), so Safari before 26.2 (every
 * iPhone not on the latest iOS) and other older browsers failed on every
 * PDF. The legacy build ships polyfills for them.
 */
export function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs").then(
    (mod) => {
      // The worker file carries the version, so it always matches this library.
      mod.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker-${mod.version}.min.mjs`;
      pdfjsInfo = { version: mod.version, workerSrc: mod.GlobalWorkerOptions.workerSrc };
      return mod;
    },
    (e: unknown) => {
      pdfjsPromise = null;
      const err = PdfError.from(e, "reader");
      err.code = "READER_FAILED";
      throw err;
    },
  );
  return pdfjsPromise;
}

/** The loaded pdf.js version and worker URL, or null before pdf.js has loaded. */
export const loadedPdfJsInfo = () => pdfjsInfo;

/**
 * A page's text content, read chunk by chunk with the stream's reader.
 * pdf.js's own page.getTextContent() loops over the stream with
 * `for await…of`, which needs ReadableStream async iteration. Safari has it
 * only in its newest releases (Safari 27 in MDN's data), so on older iPhones
 * (tested in WebKit 17.4, 18.0, 18.2 and 26.0) it threw "undefined is not a
 * function" for every page after the document had opened. pdf.js's legacy
 * build doesn't polyfill it.
 */
export async function readTextContent(page: PDFPageProxy): Promise<TextContent> {
  const reader = (page.streamTextContent() as ReadableStream<TextContent>).getReader();
  const content: TextContent = { items: [], styles: Object.create(null), lang: null };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      content.lang ??= value.lang;
      Object.assign(content.styles, value.styles);
      for (const item of value.items) content.items.push(item);
    }
  } finally {
    reader.releaseLock();
  }
  return content;
}

/** Checks the "%PDF-" signature in the first kilobyte (some files have junk before it). */
export function hasPdfSignature(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 1024);
  for (let i = 0; i + 4 < head.length; i++) {
    if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46 && head[i + 4] === 0x2d) return true;
  }
  return false;
}

/**
 * Opens a PDF in the pdf.js worker. pdf.js takes over (detaches) the buffer,
 * so pass a copy if it is needed afterwards. Failures are PdfErrors with a
 * specific code; the original message is kept for diagnosis, never shown.
 */
export async function openPdf(buffer: ArrayBuffer, { signal, password }: { signal?: AbortSignal; password?: string } = {}): Promise<PDFDocumentProxy> {
  if (buffer.byteLength > MAX_PDF_BYTES) throw new PdfError("TOO_LARGE");
  if (!hasPdfSignature(new Uint8Array(buffer))) throw new PdfError("NOT_PDF");
  const pdfjs = await loadPdfJs();
  if (signal?.aborted) throw new PdfError("ABORTED");
  let task: ReturnType<PdfJs["getDocument"]>;
  try {
    task = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      password,
      disableFontFace: true,
      stopAtErrors: false,
      // Text of PDFs whose fonts use predefined character maps (CJK), standard
      // fonts and image decoders (JBIG2/JPEG 2000 scans, rendered for OCR).
      cMapUrl: `${PDFJS_BASE}/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${PDFJS_BASE}/standard_fonts/`,
      wasmUrl: `${PDFJS_BASE}/wasm/`,
    });
  } catch (e) {
    throw PdfError.from(e, "open");
  }
  const onAbort = () => void task.destroy();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const doc = await task.promise;
    if (doc.numPages < 1) {
      void task.destroy();
      throw new PdfError("INVALID", "no pages");
    }
    return doc;
  } catch (e) {
    if (signal?.aborted) throw new PdfError("ABORTED");
    throw PdfError.from(e, "open");
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Releases the document and its worker resources. */
export function destroyPdf(doc: PDFDocumentProxy): void {
  void doc.loadingTask.destroy();
}

interface Line {
  y: number;
  height: number;
  items: TextItem[];
}

function isTextItem(item: unknown): item is TextItem {
  return typeof (item as TextItem).str === "string" && Array.isArray((item as TextItem).transform);
}

const RTL_CHAR = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}]/u;
const LETTER = /\p{L}/u;

function lineIsRtl(items: TextItem[]): boolean {
  let rtl = 0;
  let ltr = 0;
  for (const it of items) {
    for (const ch of it.str) {
      if (RTL_CHAR.test(ch)) rtl++;
      else if (LETTER.test(ch)) ltr++;
    }
  }
  return rtl > ltr;
}

/**
 * The items of one line in reading order, with diacritics drawn as their own
 * items (Arabic shadda, damma…) attached to the letter whose centre is
 * nearest: sorting them by position alone can put them on the neighbouring
 * letter. `text(item)` gives an item's text with its marks.
 */
export function orderLineItems(items: TextItem[], rtl: boolean): { sorted: TextItem[]; text: (item: TextItem) => string } {
  const isMark = (i: TextItem) => /^\p{M}+$/u.test(i.str);
  const sorted = items.filter((i) => !isMark(i)).sort((a, b) => (rtl ? b.transform[4] - a.transform[4] : a.transform[4] - b.transform[4]));
  const centre = (i: TextItem) => i.transform[4] + i.width / 2;
  const marksOf = new Map<TextItem, string>();
  for (const m of items.filter(isMark)) {
    const x = centre(m);
    const base = sorted.filter((i) => i.str.trim()).reduce<TextItem | null>((best, i) => (!best || Math.abs(centre(i) - x) < Math.abs(centre(best) - x) ? i : best), null);
    if (base) marksOf.set(base, (marksOf.get(base) ?? "") + m.str);
  }
  // In right-to-left lines, an item may start with the mark of its first letter (visual order).
  return { sorted, text: (it) => (rtl ? it.str.replace(/^(\p{M}+)(\p{L})/u, "$2$1") : it.str) + (marksOf.get(it) ?? "") };
}

/**
 * Turns pdf.js text items into reading-order text. Items arrive in content
 * stream order (which keeps columns together); we split that stream into
 * lines and order each line by x-coordinate, right-to-left for Arabic and
 * Hebrew lines, because many PDF producers draw RTL words left to right.
 */
export function itemsToText(rawItems: unknown[]): string {
  const items = rawItems.filter(isTextItem);
  const lines: Line[] = [];
  let current: Line | null = null;
  let breakAfter = false;
  for (const item of items) {
    const y = item.transform[5];
    const h = Math.abs(item.height || item.transform[3] || 10);
    if (!item.str && !item.hasEOL) continue;
    if (!current || breakAfter || Math.abs(y - current.y) > Math.max(2, Math.min(h, current.height) * 0.6)) {
      current = { y, height: h, items: [] };
      lines.push(current);
    }
    if (item.str) current.items.push(item);
    breakAfter = item.hasEOL;
  }

  const heights = lines.map((l) => l.height).sort((a, b) => a - b);
  const typical = heights[Math.floor(heights.length / 2)] || 10;

  let out = "";
  let prev: Line | null = null;
  for (const line of lines) {
    if (!line.items.length) continue;
    const rtl = lineIsRtl(line.items);
    const ordered = orderLineItems(line.items, rtl);
    let text = "";
    let last: TextItem | null = null;
    for (const it of ordered.sorted) {
      if (last) {
        const gap = rtl ? last.transform[4] - (it.transform[4] + it.width) : it.transform[4] - (last.transform[4] + last.width);
        if (gap > line.height * 0.15 && !/\s$/u.test(text) && !/^[\s\p{M}]/u.test(it.str)) text += " ";
      }
      text += ordered.text(it);
      last = it;
    }
    text = arabicLetters(text.normalize("NFKC").replace(/­/g, "").replace(/[ \t]+/g, " ").trim());
    if (!text) continue;
    if (prev) {
      const gap = prev.y - line.y;
      out += gap > typical * 1.8 || gap < -typical ? "\n\n" : "\n";
    }
    out += text;
    prev = line;
  }
  return out;
}

/** Text of each selected page, in page order; "" for pages without a text layer. */
export type PageTexts = Map<number, string>;

export interface PdfExtraction {
  pages: PageTexts;
  /** 1-based numbers of selected pages that contained no extractable text (scanned images). */
  emptyPages: number[];
  /** Pages pdf.js failed on (or that timed out); left out, never replaced with invented text. */
  failedPages: number[];
}

export function withTimeout<T>(p: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      onTimeout?.();
      reject(new PdfError("TIMEOUT"));
    }, ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/** A page counts as empty when it has fewer than two visible characters. */
export const isBlankText = (text: string) => text.replace(/\s/g, "").length < 2;

/**
 * Reads the text layer of the selected pages, one page at a time (pages are
 * released as soon as they are read, so long books stay within memory).
 * Image-only pages are reported, not dropped. A page pdf.js fails on is
 * listed in failedPages and the others are kept; only when every page fails
 * does the whole extraction fail.
 */
export async function extractPdfText(
  doc: PDFDocumentProxy,
  pages: number[],
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<PdfExtraction> {
  const texts: PageTexts = new Map();
  const emptyPages: number[] = [];
  const failedPages: number[] = [];
  let lastError: PdfError | null = null;
  for (let i = 0; i < pages.length; i++) {
    if (signal?.aborted) throw new PdfError("ABORTED");
    const pageNo = pages[i];
    let stage: PdfStage = "page";
    try {
      const page = await withTimeout(doc.getPage(pageNo), PDF_PAGE_TIMEOUT_MS);
      stage = "text";
      try {
        const content = await withTimeout(readTextContent(page), PDF_PAGE_TIMEOUT_MS);
        const text = itemsToText(content.items);
        if (isBlankText(text)) {
          emptyPages.push(pageNo);
          texts.set(pageNo, "");
        } else {
          texts.set(pageNo, text);
        }
      } finally {
        page.cleanup();
      }
    } catch (e) {
      if (signal?.aborted) throw new PdfError("ABORTED");
      // Out of memory or a missing browser feature will fail every page: stop now.
      const err = PdfError.from(e, stage);
      if (err.code === "MEMORY" || err.code === "UNSUPPORTED_BROWSER" || err.code === "READER_FAILED") throw err;
      failedPages.push(pageNo);
      lastError = err;
    }
    onProgress?.(i + 1, pages.length);
    // Let React paint progress between pages.
    await new Promise((r) => setTimeout(r, 0));
  }
  if (pages.length && failedPages.length === pages.length) {
    const err = new PdfError("EXTRACT_FAILED", lastError?.message);
    err.stage = lastError?.stage;
    err.original = lastError?.original;
    throw err;
  }
  return { pages: texts, emptyPages, failedPages };
}

/** Joins page texts in page order, skipping pages that are still empty. */
export function joinPages(pages: PageTexts): string {
  return [...pages.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, text]) => text.trim())
    .filter(Boolean)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Page selection
// ---------------------------------------------------------------------------

export type PageSelectionError =
  | { code: "EMPTY" }
  /** Something that isn't a page number or range, e.g. "5-" or "a". */
  | { code: "SYNTAX"; part: string }
  /** Page 0 (or a negative number). */
  | { code: "ZERO"; part: string }
  /** "10-5": the range runs backwards. */
  | { code: "REVERSED"; part: string }
  /** A page after the last one. */
  | { code: "OUT_OF_RANGE"; part: string; max: number };

export type PageSelection = { ok: true; pages: number[] } | { ok: false; error: PageSelectionError };

/** Arabic-Indic and Eastern Arabic-Indic (Persian/Urdu) digits as Western digits. */
export function westernDigits(s: string): string {
  return s.replace(/[٠-٩]/gu, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/gu, (d) => String(d.charCodeAt(0) - 0x6f0));
}

/**
 * Parses a page selection such as "5", "5-10" or "1-5,8,12-20" (also with
 * Arabic-Indic digits, the Arabic comma and any dash). The pages come back
 * sorted and without duplicates. Nothing is guessed: any part that isn't a
 * valid page or range within 1..max makes the whole selection invalid.
 */
export function parsePageSelection(input: string, max: number): PageSelection {
  const text = westernDigits(input)
    .replace(/[‐-―−﹘﹣－]/gu, "-")
    .replace(/[،؛;]/gu, ",")
    .trim();
  if (!text) return { ok: false, error: { code: "EMPTY" } };
  const pages = new Set<number>();
  const parts = text.split(",");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (!part) {
      // A trailing comma ("1-5,") is harmless; an empty part elsewhere ("1,,2") is a typo.
      if (i === parts.length - 1 && i > 0) continue;
      return { ok: false, error: { code: "SYNTAX", part: "," } };
    }
    const m = /^(-?\d+)\s*(?:-\s*(-?\d+))?$/u.exec(part);
    if (!m) return { ok: false, error: { code: "SYNTAX", part } };
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    if (a < 1 || b < 1) return { ok: false, error: { code: "ZERO", part } };
    if (b < a) return { ok: false, error: { code: "REVERSED", part } };
    if (b > max) return { ok: false, error: { code: "OUT_OF_RANGE", part, max } };
    for (let p = a; p <= b; p++) pages.add(p);
  }
  if (!pages.size) return { ok: false, error: { code: "EMPTY" } };
  return { ok: true, pages: [...pages].sort((x, y) => x - y) };
}

/** Parses a page selection; null when it isn't valid (see parsePageSelection for the reason). */
export function parsePageRange(input: string, max: number): number[] | null {
  const r = parsePageSelection(input, max);
  return r.ok ? r.pages : null;
}

/** Sorted pages written compactly: [1,2,3,5,8,9] → "1-3, 5, 8-9". */
export function formatPageList(pages: number[], separator = ", "): string {
  const out: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    out.push(j > i ? `${pages[i]}-${pages[j]}` : String(pages[i]));
    i = j;
  }
  return out.join(separator);
}

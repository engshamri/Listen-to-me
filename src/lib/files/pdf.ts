/**
 * In-browser PDF text extraction with pdf.js. Documents never leave the
 * user's device. Runs pdf.js in its web worker, so the UI stays responsive.
 */
import type { PDFDocumentProxy, TextItem } from "pdfjs-dist/types/src/display/api";
import { MAX_PDF_BYTES, PDF_PAGE_TIMEOUT_MS } from "./limits";

export type PdfErrorCode = "NOT_PDF" | "TOO_LARGE" | "ENCRYPTED" | "INVALID" | "NO_TEXT" | "TIMEOUT" | "ABORTED" | "OCR_FAILED";

export class PdfError extends Error {
  constructor(public code: PdfErrorCode, message?: string) {
    super(message ?? code);
  }
}

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import("pdfjs-dist").then((mod) => {
    mod.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    return mod;
  });
  return pdfjsPromise;
}

/** Checks the "%PDF-" signature in the first kilobyte (some files have junk before it). */
export function hasPdfSignature(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 1024);
  for (let i = 0; i + 4 < head.length; i++) {
    if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46 && head[i + 4] === 0x2d) return true;
  }
  return false;
}

export async function openPdf(buffer: ArrayBuffer, signal?: AbortSignal): Promise<PDFDocumentProxy> {
  if (buffer.byteLength > MAX_PDF_BYTES) throw new PdfError("TOO_LARGE");
  if (!hasPdfSignature(new Uint8Array(buffer))) throw new PdfError("NOT_PDF");
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    stopAtErrors: false,
  });
  const onAbort = () => void task.destroy();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await task.promise;
  } catch (e) {
    if (signal?.aborted) throw new PdfError("ABORTED");
    const name = (e as { name?: string })?.name;
    if (name === "PasswordException") throw new PdfError("ENCRYPTED");
    throw new PdfError("INVALID", (e as Error)?.message);
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
    const sorted = [...line.items].sort((a, b) => (rtl ? b.transform[4] - a.transform[4] : a.transform[4] - b.transform[4]));
    let text = "";
    let last: TextItem | null = null;
    for (const it of sorted) {
      if (last) {
        const gap = rtl ? last.transform[4] - (it.transform[4] + it.width) : it.transform[4] - (last.transform[4] + last.width);
        if (gap > line.height * 0.15 && !/\s$/u.test(text) && !/^\s/u.test(it.str)) text += " ";
      }
      text += it.str;
      last = it;
    }
    text = text.normalize("NFKC").replace(/­/g, "").replace(/[ \t]+/g, " ").trim();
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

/** Reads the text layer of the selected pages. Image-only pages are reported, not dropped. */
export async function extractPdfText(
  doc: PDFDocumentProxy,
  pages: number[],
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<PdfExtraction> {
  const texts: PageTexts = new Map();
  const emptyPages: number[] = [];
  for (let i = 0; i < pages.length; i++) {
    if (signal?.aborted) throw new PdfError("ABORTED");
    const pageNo = pages[i];
    const page = await withTimeout(doc.getPage(pageNo), PDF_PAGE_TIMEOUT_MS);
    const content = await withTimeout(page.getTextContent(), PDF_PAGE_TIMEOUT_MS);
    page.cleanup();
    const text = itemsToText(content.items);
    if (isBlankText(text)) {
      emptyPages.push(pageNo);
      texts.set(pageNo, "");
    } else {
      texts.set(pageNo, text);
    }
    onProgress?.(i + 1, pages.length);
    // Let React paint progress between pages.
    await new Promise((r) => setTimeout(r, 0));
  }
  return { pages: texts, emptyPages };
}

/** Joins page texts in page order, skipping pages that are still empty. */
export function joinPages(pages: PageTexts): string {
  return [...pages.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, text]) => text.trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Parses "1-3, 7, 10-12" into sorted unique page numbers within 1..max. */
export function parsePageRange(input: string, max: number): number[] | null {
  const pages = new Set<number>();
  const parts = input.replace(/[–—]/g, "-").split(/[,،\s]+/).filter(Boolean);
  if (!parts.length) return null;
  for (const part of parts) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < a || b > max) return null;
    for (let p = a; p <= b; p++) pages.add(p);
  }
  return [...pages].sort((x, y) => x - y);
}

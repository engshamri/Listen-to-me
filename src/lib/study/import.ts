/*
 * Reading a lecture PDF for the study workspace, in the browser: every page's
 * paragraphs (with positions) from the text layer. Pages without text
 * (scanned) are kept as "none" and can be recognized later with OCR.
 */
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { PDF_PAGE_TIMEOUT_MS } from "@/lib/files/limits";
import type { OcrParagraph } from "@/lib/files/ocr";
import { PdfError, isBlankText, readTextContent, withTimeout } from "@/lib/files/pdf";
import { pageParagraphs, paragraphsText, type Paragraph } from "./layout";
import type { StudyPage } from "./store";

/** Lectures longer than this are refused (memory and storage stay reasonable). */
export const MAX_STUDY_PAGES = 600;

export async function readPages(
  doc: PDFDocumentProxy,
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<Omit<StudyPage, "docId">[]> {
  const total = doc.numPages;
  const pages: Omit<StudyPage, "docId">[] = [];
  let failed = 0;
  for (let n = 1; n <= total; n++) {
    if (signal?.aborted) throw new PdfError("ABORTED");
    try {
      const page = await withTimeout(doc.getPage(n), PDF_PAGE_TIMEOUT_MS);
      try {
        const content = await withTimeout(readTextContent(page), PDF_PAGE_TIMEOUT_MS);
        const paragraphs = pageParagraphs(content.items, page.view, content.styles);
        const hasText = !isBlankText(paragraphsText(paragraphs));
        pages.push({ page: n, paragraphs: hasText ? paragraphs : [], source: hasText ? "text" : "none" });
      } finally {
        page.cleanup();
      }
    } catch (e) {
      if (signal?.aborted) throw new PdfError("ABORTED");
      const err = PdfError.from(e, "text");
      if (err.code === "MEMORY" || err.code === "UNSUPPORTED_BROWSER" || err.code === "READER_FAILED") throw err;
      // A page pdf.js can't read is kept without text (it can still be tried with OCR), never invented.
      pages.push({ page: n, paragraphs: [], source: "none" });
      if (++failed === total) {
        err.code = "EXTRACT_FAILED";
        throw err;
      }
    }
    onProgress?.(n, total);
    // Let the UI paint progress between pages.
    if (n % 4 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return pages;
}

/** Paragraphs of an OCR-recognized page. */
export function ocrParagraphs(found: OcrParagraph[]): Paragraph[] {
  return found.map((p) => ({ text: p.text, kind: "text", box: p.box }));
}

/** A readable title from a file name: "lecture_03-cell_biology.pdf" → "lecture 03 cell biology". */
export function titleFromFileName(name: string): string {
  return (
    name
      .replace(/\.pdf$/iu, "")
      .replace(/[_-]+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim() || "Lecture"
  );
}

/** The document's own title when it is a real one (not a file name or "Untitled"). */
export function usableTitle(metaTitle: unknown): string | null {
  if (typeof metaTitle !== "string") return null;
  const title = metaTitle.replace(/\s+/gu, " ").trim();
  if (title.length < 3 || title.length > 200) return null;
  if (/^(untitled|microsoft (word|powerpoint)|document\d*|presentation\d*)\b/iu.test(title) || /\.(docx?|pptx?|pdf|tex)$/iu.test(title)) return null;
  // Browsers' "print to PDF" stores the page address (or about:blank) as the title.
  if (/^(about:|data:|file:|https?:\/\/)/iu.test(title) || /^[\w.-]+\.(com|org|net|edu|io)\b/iu.test(title)) return null;
  return title;
}

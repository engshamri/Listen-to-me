/*
 * A diagnostic report for PDF failures that a student can copy and send.
 * It holds only technical facts: which stage failed, the exception (name,
 * message, first stack lines), the pdf.js version and worker, the browser and
 * the features it has, and the file's size and page count. Never the file
 * name or any text from the document. Nothing is sent anywhere by the app.
 */
import { loadedPdfJsInfo, PdfError, classifyPdfError, type PdfStage } from "./pdf";

const STAGES: Record<PdfStage, string> = {
  reader: "loading the PDF reader (pdf.js module)",
  open: "opening the document (pdf.js worker)",
  page: "loading a page",
  text: "reading page text",
  ocr: "text recognition (OCR)",
};

/** Browser features pdf.js and the importer rely on: true when present. */
export function browserFeatures(): Record<string, boolean> {
  const has = (test: () => unknown) => {
    try {
      return Boolean(test());
    } catch {
      return false;
    }
  };
  const proto = (o: unknown, key: PropertyKey) => has(() => typeof (o as Record<PropertyKey, unknown>)[key] === "function");
  return {
    Worker: has(() => typeof Worker === "function"),
    ReadableStream: has(() => typeof ReadableStream === "function"),
    "ReadableStream async iteration": has(() => proto(ReadableStream.prototype, Symbol.asyncIterator)),
    DecompressionStream: has(() => typeof DecompressionStream === "function"),
    OffscreenCanvas: has(() => typeof OffscreenCanvas === "function"),
    WebAssembly: has(() => typeof WebAssembly === "object"),
    structuredClone: has(() => typeof structuredClone === "function"),
    "Promise.withResolvers": proto(Promise, "withResolvers"),
    "Promise.try": proto(Promise, "try"),
    "Uint8Array#toHex": proto(Uint8Array.prototype, "toHex"),
    "Map#getOrInsertComputed": proto(Map.prototype, "getOrInsertComputed"),
    "Math.sumPrecise": proto(Math, "sumPrecise"),
    "Intl.Segmenter": has(() => typeof Intl.Segmenter === "function"),
  };
}

/** The deployed version (Vercel exposes the commit), or "local". */
export const appBuild = () => (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || "local";

export interface DiagnosticContext {
  /** What the student was doing, e.g. "import PDF (Text page)". */
  action: string;
  fileSize?: number;
  pageCount?: number;
  pagesSelected?: number;
  /** Whether the document had opened in the worker before the failure. */
  documentOpened?: boolean;
}

/** A plain-text report of a PDF failure (safe to share: see the top of this file). */
export function diagnosticReport(error: unknown, ctx: DiagnosticContext): string {
  const err = error instanceof PdfError ? error : PdfError.from(error, "open");
  const code = err.code ?? classifyPdfError(error);
  const original = err.original ?? { name: err.name, message: err.message, stack: "" };
  const info = loadedPdfJsInfo();
  const features = browserFeatures();
  const lines = [
    "Listen to me — PDF diagnostic report",
    `Time: ${new Date().toISOString()}`,
    `App build: ${appBuild()}`,
    `Action: ${ctx.action}`,
    `Result: ${code}${err.stage ? ` at stage "${err.stage}" (${STAGES[err.stage]})` : ""}`,
    `Error: ${original.name}: ${original.message}`,
  ];
  if (original.stack) lines.push("Stack:", ...original.stack.split("\n").map((l) => `  ${l.trim()}`));
  lines.push(
    `pdf.js: ${info ? `${info.version} (legacy build), worker ${info.workerSrc}` : "not loaded"}`,
    `Document opened in the worker: ${ctx.documentOpened ? "yes" : "no"}`,
    `File: ${ctx.fileSize !== undefined ? `${(ctx.fileSize / 1024 / 1024).toFixed(2)} MB` : "?"}${ctx.pageCount ? `, ${ctx.pageCount} pages` : ""}${ctx.pagesSelected ? `, ${ctx.pagesSelected} selected` : ""} (name not included)`,
    `Browser: ${typeof navigator !== "undefined" ? navigator.userAgent : "?"}`,
    `Screen: ${typeof window !== "undefined" ? `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x` : "?"}, language ${typeof navigator !== "undefined" ? navigator.language : "?"}`,
    "Features:",
    ...Object.entries(features).map(([k, v]) => `  ${v ? "yes" : "NO "}  ${k}`),
  );
  return lines.join("\n");
}

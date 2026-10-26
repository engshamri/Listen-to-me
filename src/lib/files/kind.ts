/*
 * What kind of file the user chose, decided from its first bytes. Phones
 * often report an empty or generic type ("application/octet-stream") and
 * files from cloud providers may lack an extension, so neither the name nor
 * the MIME type is trusted on its own. pdf.js makes the final decision about
 * whether a PDF can be read.
 */
import { hasPdfSignature } from "./pdf";

export type FileKind = "pdf" | "txt";
export type KindResult = { kind: FileKind } | { kind: null; reason: "NOT_PDF" | "UNSUPPORTED" };

/** Bytes read to decide: enough for the PDF signature (first KB) and a text check. */
export const KIND_SNIFF_BYTES = 4096;

const PDF_NAME = /\.pdf$/iu;
const TEXT_NAME = /\.(txt|text)$/iu;
/** Any other extension (".docx", ".jpg", ".md"…). */
const OTHER_NAME = /\.[\p{L}\p{N}]{1,10}$/iu;
const GENERIC_TYPES = new Set(["", "application/octet-stream", "binary/octet-stream", "application/unknown", "application/x-unknown"]);

/** No NUL bytes (unless UTF-16 with a byte-order mark) and almost no control characters. */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) return true;
  let control = 0;
  for (const b of bytes) {
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) control++;
  }
  return control <= bytes.length * 0.01;
}

export function detectKind(name: string, type: string, head: Uint8Array): KindResult {
  if (hasPdfSignature(head)) return { kind: "pdf" };
  // Named or typed as a PDF but without the signature: say so rather than "unsupported".
  if (PDF_NAME.test(name) || type === "application/pdf") return { kind: null, reason: "NOT_PDF" };
  if (TEXT_NAME.test(name) || type.startsWith("text/plain")) return { kind: "txt" };
  // No useful name or type: plain text is accepted when the bytes are text.
  if (!OTHER_NAME.test(name) && GENERIC_TYPES.has(type) && looksLikeText(head)) return { kind: "txt" };
  return { kind: null, reason: "UNSUPPORTED" };
}

/** Reads the start of a file and decides its kind; throws when the browser can't read the file. */
export async function sniffFile(file: File): Promise<KindResult> {
  const head = new Uint8Array(await file.slice(0, KIND_SNIFF_BYTES).arrayBuffer());
  return detectKind(file.name, file.type, head);
}

/**
 * The file picker's filter. Desktop pickers get the strict list (and still
 * offer "All files"). On touch devices the list also allows the generic
 * binary type: Android and iOS pickers grey out documents whose provider
 * reports it, so a real PDF could not be tapped. The file's bytes are checked
 * after it is chosen either way.
 */
export function pickerAccept(): string {
  const strict = ".pdf,.txt,application/pdf,text/plain";
  const coarse = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  return coarse ? `${strict},application/octet-stream` : strict;
}

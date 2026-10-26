import type { TKey } from "@/lib/i18n/translate";
import type { PageSelectionError, PdfErrorCode } from "./pdf";

/** The message that explains each PDF failure, with what to do about it. */
export const PDF_ERROR_KEYS: Record<PdfErrorCode, TKey> = {
  NOT_PDF: "pdf.notPdf",
  TOO_LARGE: "pdf.tooLarge",
  PASSWORD_REQUIRED: "pdf.passwordRequired",
  PASSWORD_INCORRECT: "pdf.passwordIncorrect",
  INVALID: "pdf.invalid",
  UNSUPPORTED_FEATURE: "pdf.unsupportedFeature",
  UNSUPPORTED_BROWSER: "pdf.unsupportedBrowser",
  READER_FAILED: "pdf.readerFailed",
  MEMORY: "pdf.memory",
  READ_FAILED: "file.readFailed",
  NO_TEXT: "pdf.noText",
  TIMEOUT: "pdf.timeout",
  ABORTED: "pdf.cancelled",
  OCR_FAILED: "ocr.failed",
  EXTRACT_FAILED: "pdf.extractFailed",
  UNEXPECTED: "pdf.unexpected",
};

/** The message for an invalid page selection, and its parameters. */
export function pageSelectionMessage(error: PageSelectionError): [TKey, Record<string, string | number>] {
  switch (error.code) {
    case "EMPTY":
      return ["pdf.rangeEmpty", {}];
    case "SYNTAX":
      return ["pdf.rangeSyntax", { part: error.part }];
    case "ZERO":
      return ["pdf.rangeZero", { part: error.part }];
    case "REVERSED":
      return ["pdf.rangeReversed", { part: error.part }];
    case "OUT_OF_RANGE":
      return ["pdf.rangeOutOfRange", { part: error.part, max: error.max }];
  }
}

/** Limits shared by the editor, file import and the API. */
export const MAX_TEXT_CHARS = 300_000;
export const MAX_TXT_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_BYTES = 50 * 1024 * 1024;
/** Most pages extracted in one go; longer documents need a page range. */
export const MAX_PDF_PAGES_PER_IMPORT = 500;
export const PDF_PAGE_TIMEOUT_MS = 20_000;

/** OCR is slow (seconds per page) and memory-hungry, so it gets tighter limits. */
export const MAX_OCR_PAGES = 50;
export const OCR_PAGE_TIMEOUT_MS = 180_000;
/** Pages are rendered at about 216 dpi (3 × 72), capped so huge pages can't exhaust memory. */
export const OCR_RENDER_SCALE = 3;
export const OCR_MAX_CANVAS_SIDE = 4096;
/** Mean word confidence (0-100) below which a page is flagged for proofreading. */
export const OCR_LOW_CONFIDENCE = 70;

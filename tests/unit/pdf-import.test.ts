import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { describe, expect, it } from "vitest";
import { detectKind, looksLikeText } from "@/lib/files/kind";
import { classifyPdfError, extractPdfText, formatPageList, parsePageSelection, PdfError, westernDigits } from "@/lib/files/pdf";
import { PDF_ERROR_KEYS, pageSelectionMessage } from "@/lib/files/pdf-messages";
import en from "@/lib/i18n/messages/en";

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, "..", "fixtures", name)));
const bytes = (s: string) => new TextEncoder().encode(s);

describe("page selection", () => {
  const ok = (input: string, max = 30) => {
    const r = parsePageSelection(input, max);
    if (!r.ok) throw new Error(`expected ${input} to parse: ${JSON.stringify(r.error)}`);
    return r.pages;
  };
  const err = (input: string, max = 30) => {
    const r = parsePageSelection(input, max);
    if (r.ok) throw new Error(`expected ${input} to fail, got ${r.pages}`);
    return r.error;
  };

  it("reads single pages, inclusive ranges and lists, sorted without duplicates", () => {
    expect(ok("5")).toEqual([5]);
    expect(ok("5-10")).toEqual([5, 6, 7, 8, 9, 10]);
    expect(ok("1-5,8,12-20")).toEqual([1, 2, 3, 4, 5, 8, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(ok(" 3 - 4 , 1 ")).toEqual([1, 3, 4]);
    expect(ok("1-5,3-7,5")).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(ok("8,2,8")).toEqual([2, 8]);
    expect(ok("1-5,")).toEqual([1, 2, 3, 4, 5]);
    expect(ok("30", 30)).toEqual([30]);
  });

  it("accepts Arabic-Indic digits, the Arabic comma and every dash", () => {
    expect(ok("٥-١٠")).toEqual([5, 6, 7, 8, 9, 10]);
    expect(ok("١-٥،٨،١٢-٢٠")).toEqual(ok("1-5,8,12-20"));
    expect(ok("۳-۴")).toEqual([3, 4]); // Persian digits
    for (const dash of ["‐", "‑", "‒", "–", "—", "―", "−", "﹣", "－"]) expect(ok(`2${dash}4`)).toEqual([2, 3, 4]);
    expect(westernDigits("صفحة ١٢")).toBe("صفحة 12");
  });

  it("refuses anything malformed, with the reason, and never guesses", () => {
    expect(err("")).toEqual({ code: "EMPTY" });
    expect(err("  ")).toEqual({ code: "EMPTY" });
    expect(err("5-")).toEqual({ code: "SYNTAX", part: "5-" });
    expect(err("a")).toEqual({ code: "SYNTAX", part: "a" });
    expect(err("1,,2")).toEqual({ code: "SYNTAX", part: "," });
    expect(err("1 3")).toEqual({ code: "SYNTAX", part: "1 3" });
    expect(err("1-2-3")).toEqual({ code: "SYNTAX", part: "1-2-3" });
    expect(err("0")).toEqual({ code: "ZERO", part: "0" });
    expect(err("0-3")).toEqual({ code: "ZERO", part: "0-3" });
    expect(err("-2")).toEqual({ code: "ZERO", part: "-2" });
    expect(err("10-5")).toEqual({ code: "REVERSED", part: "10-5" });
    expect(err("25-31", 30)).toEqual({ code: "OUT_OF_RANGE", part: "25-31", max: 30 });
    expect(err("1-5,99", 30)).toEqual({ code: "OUT_OF_RANGE", part: "99", max: 30 });
  });

  it("every error has a message naming the problem", () => {
    for (const e of [err(""), err("5-"), err("0"), err("10-5"), err("40")]) {
      const [key, params] = pageSelectionMessage(e);
      expect(key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], en), key).toBeTypeOf("string");
      if ("part" in e) expect(params.part).toBe(e.part);
    }
  });

  it("writes page lists compactly", () => {
    expect(formatPageList([1, 2, 3, 5, 8, 9])).toBe("1-3, 5, 8-9");
    expect(formatPageList([7])).toBe("7");
    expect(formatPageList([1, 2, 3], "، ")).toBe("1-3");
    expect(formatPageList([])).toBe("");
  });
});

describe("file kind from the file's bytes", () => {
  const pdf = bytes("%PDF-1.7\n%âãÏÓ\n1 0 obj");
  const text = bytes("Lecture notes\nPage one\n");
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0x08, 0x00]);

  it("recognizes a PDF whatever its name or reported type", () => {
    expect(detectKind("Lecture.pdf", "application/pdf", pdf)).toEqual({ kind: "pdf" });
    expect(detectKind("LECTURE.PDF", "", pdf)).toEqual({ kind: "pdf" });
    expect(detectKind("lecture.pdf", "application/octet-stream", pdf)).toEqual({ kind: "pdf" });
    expect(detectKind("document", "", pdf)).toEqual({ kind: "pdf" }); // cloud file without an extension
    expect(detectKind("scan.bin", "binary/octet-stream", pdf)).toEqual({ kind: "pdf" });
  });

  it("recognizes text files, including unnamed ones whose bytes are text", () => {
    expect(detectKind("notes.txt", "text/plain", text)).toEqual({ kind: "txt" });
    expect(detectKind("NOTES.TXT", "", text)).toEqual({ kind: "txt" });
    expect(detectKind("notes.txt", "application/octet-stream", text)).toEqual({ kind: "txt" });
    expect(detectKind("notes", "", text)).toEqual({ kind: "txt" });
    expect(detectKind("notes", "", new Uint8Array([0xff, 0xfe, 0x41, 0x00]))).toEqual({ kind: "txt" }); // UTF-16
  });

  it("refuses other formats, and says when a “.pdf” isn't a PDF", () => {
    expect(detectKind("essay.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", zip)).toEqual({ kind: null, reason: "UNSUPPORTED" });
    expect(detectKind("photo.jpg", "image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ kind: null, reason: "UNSUPPORTED" });
    expect(detectKind("notes.md", "", text)).toEqual({ kind: null, reason: "UNSUPPORTED" });
    expect(detectKind("archive", "", zip)).toEqual({ kind: null, reason: "UNSUPPORTED" });
    expect(detectKind("fake.pdf", "application/pdf", text)).toEqual({ kind: null, reason: "NOT_PDF" });
    expect(looksLikeText(new Uint8Array([0x41, 0x00, 0x42]))).toBe(false);
  });
});

describe("PDF failures are classified, not all called “damaged”", () => {
  const open = (data: Uint8Array, password?: string) => pdfjs.getDocument({ data, password, disableFontFace: true }).promise;
  const codeOf = (p: Promise<PDFDocumentProxy>) =>
    p.then(
      async (doc) => {
        await doc.loadingTask.destroy();
        return "ok";
      },
      (e: unknown) => classifyPdfError(e),
    );

  it("a password-protected PDF asks for its password, a wrong one is reported, the right one opens it", async () => {
    expect(await codeOf(open(fixture("lecture-password.pdf")))).toBe("PASSWORD_REQUIRED");
    expect(await codeOf(open(fixture("lecture-password.pdf"), "wrong"))).toBe("PASSWORD_INCORRECT");
    const doc = await open(fixture("lecture-password.pdf"), "study123");
    expect(doc.numPages).toBe(5);
    const { pages } = await extractPdfText(doc, [1]);
    expect(pages.get(1)).toContain("Lecture 3: Enzymes and Metabolism");
    await doc.loadingTask.destroy();
  });

  it("an owner-restricted PDF (encrypted, no password to open, like many published books) opens and reads", async () => {
    const doc = await open(fixture("lecture-restricted.pdf"));
    const { pages } = await extractPdfText(doc, [2]);
    expect(pages.get(2)).toContain("Michaelis");
    await doc.loadingTask.destroy();
  });

  it("a file with a PDF header but no PDF structure is invalid", async () => {
    expect(await codeOf(open(bytes("%PDF-1.7\nthis is not a pdf at all\n%%EOF")))).toBe("INVALID");
  });

  it("a cut-off download that can't be rebuilt is reported as damaged", async () => {
    const full = fixture("lecture-enzymes.pdf");
    expect(await codeOf(open(full.slice(0, Math.floor(full.length * 0.7))))).toBe("INVALID");
  });

  it("missing JavaScript built-ins mean an outdated browser, not a damaged file (the cause of the false “damaged PDF” reports)", async () => {
    // Engines without Map#getOrInsertComputed (Safari < 26.2, Chrome < 145, this Node) fail in pdf.js's
    // modern build; the legacy build used by the app reads the same file.
    if (typeof (Map.prototype as { getOrInsertComputed?: unknown }).getOrInsertComputed === "function") return;
    const modern = await import("pdfjs-dist/build/pdf.mjs");
    const failure = await modern.getDocument({ data: fixture("lecture-enzymes.pdf"), disableFontFace: true }).promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(failure).not.toBeNull();
    expect(classifyPdfError(failure)).toBe("UNSUPPORTED_BROWSER");
    expect(await codeOf(open(fixture("lecture-enzymes.pdf")))).toBe("ok");
  });

  it("other failures get their own codes", () => {
    expect(classifyPdfError(Object.assign(new Error("Invalid PDF structure."), { name: "InvalidPDFException" }))).toBe("INVALID");
    expect(classifyPdfError(new Error('Setting up fake worker failed: "Failed to fetch dynamically imported module".'))).toBe("READER_FAILED");
    expect(classifyPdfError(new RangeError("Array buffer allocation failed"))).toBe("MEMORY");
    expect(classifyPdfError(new TypeError("x.toHex is not a function"))).toBe("UNSUPPORTED_BROWSER");
    expect(classifyPdfError(Object.assign(new Error("bad XObject"), { name: "UnknownErrorException" }))).toBe("UNSUPPORTED_FEATURE");
    expect(classifyPdfError(new PdfError("TIMEOUT"))).toBe("TIMEOUT");
    expect(classifyPdfError("something")).toBe("UNEXPECTED");
    for (const key of Object.values(PDF_ERROR_KEYS)) {
      expect(key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], en), key).toBeTypeOf("string");
    }
  });
});

describe("page-by-page extraction", () => {
  /** A document whose page `bad` fails to load, or fails with `error` on every page. */
  const fakeDoc = (texts: string[], { bad = [] as number[], error }: { bad?: number[]; error?: Error } = {}) =>
    ({
      getPage: async (n: number) => {
        if (error) throw error;
        if (bad.includes(n)) throw Object.assign(new Error("bad page"), { name: "UnknownErrorException" });
        return {
          getTextContent: async () => ({ items: [{ str: texts[n - 1], transform: [1, 0, 0, 1, 0, 700], width: 100, height: 12, hasEOL: false }] }),
          cleanup: () => {},
        };
      },
    }) as unknown as PDFDocumentProxy;

  it("keeps the readable pages when one page fails, and lists the failed page", async () => {
    const r = await extractPdfText(fakeDoc(["Page one text", "Page two text", "Page three text"], { bad: [2] }), [1, 2, 3]);
    expect([...r.pages.keys()]).toEqual([1, 3]);
    expect(r.failedPages).toEqual([2]);
    expect(r.emptyPages).toEqual([]);
  });

  it("fails as a whole only when no page can be read, or at once for memory or browser problems", async () => {
    await expect(extractPdfText(fakeDoc(["a", "b"], { bad: [1, 2] }), [1, 2])).rejects.toMatchObject({ code: "EXTRACT_FAILED" });
    await expect(extractPdfText(fakeDoc(["a", "b"], { error: new RangeError("Out of memory") }), [1, 2])).rejects.toMatchObject({ code: "MEMORY" });
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(extractPdfText(fakeDoc(["a"]), [1], { signal: ctrl.signal })).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("extracts exactly the chosen pages, in order, from the real lecture", async () => {
    const doc = await pdfjs.getDocument({ data: fixture("lecture-enzymes.pdf"), disableFontFace: true }).promise;
    const r = await extractPdfText(doc, parsePageSelection("2-3", doc.numPages).ok ? [2, 3] : []);
    expect([...r.pages.keys()]).toEqual([2, 3]);
    expect(r.pages.get(2)).toContain("Michaelis");
    // Arabic letters, not the Persian forms many fonts map them to, and shadda on its letter.
    expect(r.pages.get(3)).toContain("الإنزيمات في الجسم");
    expect(r.pages.get(3)).toContain("تسرّع التفاعلات الكيميائية");
    expect(r.pages.get(3)).not.toMatch(/[یکھ]/u);
    await doc.loadingTask.destroy();
  });
});

import { describe, expect, it } from "vitest";
import { decodeTextFile, TextDecodeError } from "@/lib/files/decode-text";
import { tidyOcrText } from "@/lib/files/ocr";
import { hasPdfSignature, isBlankText, itemsToText, joinPages, parsePageRange } from "@/lib/files/pdf";

const enc = (s: string) => new TextEncoder().encode(s);
const buf = (bytes: number[] | Uint8Array) => new Uint8Array(bytes).buffer;

describe("decodeTextFile", () => {
  it("decodes UTF-8 with Arabic and English", () => {
    const r = decodeTextFile(enc("مرحبا Hello\r\nسطر").buffer as ArrayBuffer);
    expect(r).toEqual({ text: "مرحبا Hello\nسطر", encoding: "utf-8", confident: true });
  });

  it("strips the UTF-8 BOM", () => {
    const r = decodeTextFile(buf([0xef, 0xbb, 0xbf, ...enc("نص")]));
    expect(r.text).toBe("نص");
    expect(r.confident).toBe(true);
  });

  it("decodes UTF-16 LE and BE with BOM", () => {
    const le = [0xff, 0xfe, 0x45, 0x06, 0x31, 0x06]; // "مر"
    const be = [0xfe, 0xff, 0x06, 0x45, 0x06, 0x31];
    expect(decodeTextFile(buf(le)).text).toBe("مر");
    expect(decodeTextFile(buf(be)).text).toBe("مر");
  });

  it("recognises UTF-16 without a BOM but marks it as a guess", () => {
    const bytes: number[] = [];
    for (const ch of "Hello world, this is UTF-16") bytes.push(ch.charCodeAt(0), 0);
    const r = decodeTextFile(buf(bytes));
    expect(r.encoding).toBe("utf-16le");
    expect(r.text).toBe("Hello world, this is UTF-16");
    expect(r.confident).toBe(false);
  });

  it("falls back to Windows-1256 for legacy Arabic files and says it guessed", () => {
    // "مرحبا" in Windows-1256
    const r = decodeTextFile(buf([0xe3, 0xd1, 0xcd, 0xc8, 0xc7, 0x20, 0xe3, 0xd1, 0xcd, 0xc8, 0xc7]));
    expect(r.encoding).toBe("windows-1256");
    expect(r.text).toBe("مرحبا مرحبا");
    expect(r.confident).toBe(false);
  });

  it("lets the user force an encoding", () => {
    const r = decodeTextFile(buf([0xe3, 0xd1, 0xcd, 0xc8, 0xc7]), "windows-1256");
    expect(r.text).toBe("مرحبا");
    expect(r.confident).toBe(true);
  });

  it("rejects binary and empty files", () => {
    const binary = new Uint8Array(2000).map((_, i) => (i % 7 === 0 ? 1 : 65 + (i % 20)));
    expect(() => decodeTextFile(binary.buffer)).toThrow(TextDecodeError);
    expect(() => decodeTextFile(new ArrayBuffer(0))).toThrow(TextDecodeError);
    expect(() => decodeTextFile(enc("   \n").buffer as ArrayBuffer)).toThrow(TextDecodeError);
  });
});

describe("PDF helpers", () => {
  it("checks the PDF signature", () => {
    expect(hasPdfSignature(enc("%PDF-1.7\n..."))).toBe(true);
    expect(hasPdfSignature(enc("\n\n%PDF-1.4"))).toBe(true);
    expect(hasPdfSignature(enc("PK\u0003\u0004 not a pdf"))).toBe(false);
  });

  it("parses page ranges", () => {
    expect(parsePageRange("1-3, 7, 10-11", 20)).toEqual([1, 2, 3, 7, 10, 11]);
    expect(parsePageRange("2، 4", 5)).toEqual([2, 4]);
    expect(parsePageRange("3–5", 5)).toEqual([3, 4, 5]);
    expect(parsePageRange("0-2", 5)).toBeNull();
    expect(parsePageRange("4-2", 5)).toBeNull();
    expect(parsePageRange("1-99", 5)).toBeNull();
    expect(parsePageRange("abc", 5)).toBeNull();
  });

  const item = (str: string, x: number, y: number, width: number, hasEOL = false) => ({
    str, dir: "ltr", transform: [10, 0, 0, 10, x, y], width, height: 10, fontName: "f", hasEOL,
  });

  it("orders right-to-left lines by descending x", () => {
    // Producer drew the Arabic words left to right: "العالم" (x=10) then "مرحبا" (x=80).
    const text = itemsToText([item("العالم", 10, 700, 50), item("مرحبا", 80, 700, 50, true)]);
    expect(text).toBe("مرحبا العالم");
  });

  it("keeps left-to-right lines and detects paragraph gaps", () => {
    const text = itemsToText([
      item("Hello", 10, 700, 40), item("world", 60, 700, 40, true),
      item("Next", 10, 686, 30, true),
      item("New paragraph", 10, 640, 90, true),
    ]);
    expect(text).toBe("Hello world\nNext\n\nNew paragraph");
  });

  it("normalizes Arabic presentation forms to regular letters", () => {
    // U+FEE3 U+FEAE = presentation forms of م ر
    expect(itemsToText([item("ﻣﺮ", 10, 700, 20, true)])).toBe("مر");
  });
});

describe("scanned pages and OCR results", () => {
  it("merges text-layer and OCR pages in page order and never drops content", () => {
    const pages = new Map([
      [3, "Page three (text layer)"],
      [1, "الصفحة الأولى"],
      [2, ""], // image-only page still waiting for OCR
    ]);
    expect(joinPages(pages)).toBe("الصفحة الأولى\n\nPage three (text layer)");
    pages.set(2, "Recognized from the scan");
    expect(joinPages(pages)).toBe("الصفحة الأولى\n\nRecognized from the scan\n\nPage three (text layer)");
  });

  it("treats pages with fewer than two visible characters as blank", () => {
    expect(isBlankText(" \n\t")).toBe(true);
    expect(isBlankText(" a ")).toBe(true);
    expect(isBlankText("مر")).toBe(false);
  });

  it("tidies OCR output without changing the words", () => {
    expect(tidyOcrText("Line one   \r\nLine  two\n\n\n\nسطر عربي  \n")).toBe("Line one\nLine two\n\nسطر عربي");
  });
});

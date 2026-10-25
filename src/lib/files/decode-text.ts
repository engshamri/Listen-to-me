/**
 * Decodes the bytes of a .txt file without silently corrupting characters.
 *
 * Order of detection:
 *  1. Byte-order marks (UTF-8, UTF-16 LE/BE) — certain.
 *  2. Strict UTF-8 — certain when it decodes without errors.
 *  3. UTF-16 without BOM, recognised by the pattern of zero bytes.
 *  4. Legacy single-byte code pages (Windows-1256 for Arabic, else
 *     Windows-1252) — *not* certain; the UI tells the user and lets them pick
 *     another encoding.
 */

export const TEXT_ENCODINGS = ["utf-8", "utf-16le", "utf-16be", "windows-1256", "iso-8859-6", "windows-1252", "windows-1251"] as const;
export type TextEncoding = (typeof TEXT_ENCODINGS)[number];

export interface DecodedText {
  text: string;
  encoding: TextEncoding;
  /** False when the encoding was guessed and the user should verify the text. */
  confident: boolean;
}

export class TextDecodeError extends Error {
  constructor(public code: "BINARY" | "EMPTY") {
    super(code);
  }
}

function decode(bytes: Uint8Array, encoding: TextEncoding, fatal = false): string {
  return new TextDecoder(encoding, { fatal, ignoreBOM: false }).decode(bytes);
}

function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 8192);
  let control = 0;
  for (const b of sample) if (b < 9 || (b > 13 && b < 32 && b !== 27)) control++;
  return sample.length > 0 && control / sample.length > 0.02;
}

function utf16WithoutBom(bytes: Uint8Array): TextEncoding | null {
  const n = Math.min(bytes.length, 4096) & ~1;
  if (n < 4) return null;
  let evenZeros = 0;
  let oddZeros = 0;
  for (let i = 0; i < n; i += 2) {
    if (bytes[i] === 0) evenZeros++;
    if (bytes[i + 1] === 0) oddZeros++;
  }
  const pairs = n / 2;
  if (oddZeros / pairs > 0.3 && evenZeros / pairs < 0.05) return "utf-16le";
  if (evenZeros / pairs > 0.3 && oddZeros / pairs < 0.05) return "utf-16be";
  return null;
}

export function decodeTextFile(buffer: ArrayBuffer, forced?: TextEncoding): DecodedText {
  const bytes = new Uint8Array(buffer);
  if (bytes.length === 0) throw new TextDecodeError("EMPTY");

  if (forced) return finish(decode(bytes, forced), forced, true);

  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return finish(decode(bytes, "utf-8"), "utf-8", true);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return finish(decode(bytes, "utf-16le"), "utf-16le", true);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return finish(decode(bytes, "utf-16be"), "utf-16be", true);

  const utf16 = utf16WithoutBom(bytes);
  if (utf16) return finish(decode(bytes, utf16), utf16, false);

  if (looksBinary(bytes)) throw new TextDecodeError("BINARY");

  try {
    return finish(decode(bytes, "utf-8", true), "utf-8", true);
  } catch {
    // Not valid UTF-8: fall back to a legacy code page and say so.
  }
  const arabic = decode(bytes, "windows-1256");
  const arabicLetters = (arabic.match(/\p{Script=Arabic}/gu) ?? []).length;
  const letters = (arabic.match(/\p{L}/gu) ?? []).length;
  if (letters > 0 && arabicLetters / letters > 0.3) return finish(arabic, "windows-1256", false);
  return finish(decode(bytes, "windows-1252"), "windows-1252", false);
}

function finish(text: string, encoding: TextEncoding, confident: boolean): DecodedText {
  const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/\u0000/g, "");
  if (!clean.trim()) throw new TextDecodeError("EMPTY");
  return { text: clean, encoding, confident };
}

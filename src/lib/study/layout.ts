/*
 * Page layout for the study workspace: pdf.js text items → paragraphs with
 * their position on the page, so the text panel, translations and the PDF
 * stay linked paragraph by paragraph.
 *
 * Content kinds are kept apart because students need them intact:
 *  - code (monospace fonts) and formulas keep their lines and are never translated;
 *  - table rows keep their cells (separated by " | ");
 *  - list items and headings stay separate paragraphs.
 */
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { orderLineItems } from "@/lib/files/pdf";
import { arabicLetters } from "@/lib/text/arabic-letters";

export type ParagraphKind = "text" | "heading" | "list" | "code" | "math" | "table";

/** [left, top, width, height] as fractions of the page (top-left origin). */
export type Box = [number, number, number, number];

export interface Paragraph {
  text: string;
  kind: ParagraphKind;
  box: Box;
}

/** Kinds that are shown as they are and never sent for translation. */
export const UNTRANSLATED_KINDS: ReadonlySet<ParagraphKind> = new Set(["code", "math"]);

interface Line {
  y: number;
  height: number;
  items: TextItem[];
  text: string;
  rtl: boolean;
  left: number;
  right: number;
  bottom: number;
  top: number;
  mono: boolean;
  /** Wide horizontal gaps between items: 2+ suggests a table row. */
  cells: string[];
  /** Average character width of monospace text (to rebuild code indentation). */
  charWidth: number;
}

const RTL_CHAR = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}]/u;
const LETTER = /\p{L}/u;
const LIST_MARKER = /^(?:[•●▪◦‣∙·○■□➢➤►-]|\(?\d{1,2}[.)]|\(?[a-z][.)]|\(?[ivx]{1,4}[.)])\s+/iu;
const MATH_CHAR = /[=+×÷∑∏∫√≤≥≈≠∞∂∆∇πθλμσΩαβγδεφψω^_∈∉⊂⊆∪∩→⇒⇔±·′″]/u;

function isTextItem(item: unknown): item is TextItem {
  return typeof (item as TextItem).str === "string" && Array.isArray((item as TextItem).transform);
}

function isRtl(items: TextItem[]): boolean {
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

export { arabicLetters } from "@/lib/text/arabic-letters";

/** True for lines that read as a formula: math symbols and few words. */
export function looksLikeMath(text: string): boolean {
  const symbols = [...text].filter((c) => MATH_CHAR.test(c)).length;
  if (symbols < 1) return false;
  const words = text.split(/\s+/u).filter((w) => /\p{L}{3,}/u.test(w)).length;
  return words <= 3 && symbols >= 1 && text.length <= 160;
}

function buildLines(items: TextItem[], monoFonts: Set<string>): Line[] {
  const groups: { y: number; height: number; items: TextItem[] }[] = [];
  let current: { y: number; height: number; items: TextItem[] } | null = null;
  let breakAfter = false;
  for (const item of items) {
    const y = item.transform[5];
    const h = Math.abs(item.height || item.transform[3] || 10);
    if (!item.str && !item.hasEOL) continue;
    if (!current || breakAfter || Math.abs(y - current.y) > Math.max(2, Math.min(h, current.height) * 0.6)) {
      current = { y, height: h, items: [] };
      groups.push(current);
    }
    if (item.str) {
      current.items.push(item);
      current.height = Math.max(current.height, h);
    }
    breakAfter = item.hasEOL;
  }

  const lines: Line[] = [];
  for (const g of groups) {
    if (!g.items.length) continue;
    const rtl = isRtl(g.items);
    // Diacritics drawn as their own items go with the nearest letter (see orderLineItems).
    const { sorted, text: withMarks } = orderLineItems(g.items, rtl);
    let text = "";
    const cells: string[] = [""];
    let last: TextItem | null = null;
    let monoChars = 0;
    let chars = 0;
    let monoWidth = 0;
    // Some producers (Chrome among them) write the space between table cells as one wide
    // whitespace item: it counts as a cell break, and gaps are measured between visible items.
    let wideSpace = false;
    for (const it of sorted) {
      if (!it.str.trim()) {
        if (it.width > g.height * 1.6) wideSpace = true;
        if (text && !/\s$/u.test(text)) text += " ";
        continue;
      }
      if (last) {
        const gap = rtl ? last.transform[4] - (it.transform[4] + it.width) : it.transform[4] - (last.transform[4] + last.width);
        if (wideSpace || gap > g.height * 1.6) cells.push("");
        // A combining mark (e.g. Arabic shadda drawn as its own item) belongs to the previous letter.
        if (gap > g.height * 0.15 && !/\s$/u.test(text) && !/^[\s\p{M}]/u.test(it.str)) text += " ";
      }
      wideSpace = false;
      text += withMarks(it);
      cells[cells.length - 1] += (cells[cells.length - 1] && !/^\s/u.test(it.str) ? " " : "") + it.str;
      const n = it.str.replace(/\s/gu, "").length;
      chars += n;
      if (monoFonts.has(it.fontName)) {
        monoChars += n;
        monoWidth += it.width;
      }
      last = it;
    }
    text = text.normalize("NFKC").replace(/­/gu, "").replace(/[ \t]+/gu, " ").trim();
    if (!text) continue;
    if (rtl) text = arabicLetters(text);
    const visible = g.items.filter((i) => i.str.trim());
    const left = Math.min(...visible.map((i) => i.transform[4]));
    const right = Math.max(...visible.map((i) => i.transform[4] + i.width));
    lines.push({
      charWidth: monoChars ? monoWidth / monoChars : 0,
      y: g.y,
      height: g.height,
      items: sorted,
      text,
      rtl,
      left,
      right,
      bottom: g.y - g.height * 0.25,
      top: g.y + g.height,
      mono: chars > 0 && monoChars / chars > 0.6,
      cells: cells.map((c) => c.normalize("NFKC").replace(/\s+/gu, " ").trim()).filter(Boolean),
    });
  }
  return lines;
}

function lineKind(line: Line, typical: number): ParagraphKind {
  if (line.mono) return "code";
  if (line.cells.length >= 3) return "table";
  if (looksLikeMath(line.text)) return "math";
  if (LIST_MARKER.test(line.text)) return "list";
  if (line.height >= typical * 1.3 && line.text.length <= 140) return "heading";
  return "text";
}

/** Code lines with their indentation, measured in characters from the block's left edge. */
function indentedCode(group: Line[]): string {
  const left = Math.min(...group.map((l) => l.left));
  const charWidth = group.find((l) => l.charWidth > 0)?.charWidth || 6;
  return group.map((l) => " ".repeat(Math.max(0, Math.round((l.left - left) / charWidth))) + l.text).join("\n");
}

/**
 * Joins wrapped lines of prose. A line ending in "letter-" followed by a
 * lowercase letter is a word hyphenated at the line break (as typeset lecture
 * notes do constantly), so the hyphen is removed.
 */
function joinProse(lines: string[]): string {
  let out = "";
  for (const l of lines) {
    if (!out) out = l;
    else if (/\p{L}-$/u.test(out) && /^\p{Ll}/u.test(l)) out = out.slice(0, -1) + l;
    else out += ` ${l}`;
  }
  return out;
}

/**
 * Paragraphs of one page, in reading order (content-stream order, which keeps
 * columns together). `view` is the page's [x0, y0, x1, y1] box in PDF units;
 * `styles` is pdf.js textContent.styles (used to recognize monospace fonts).
 */
export function pageParagraphs(rawItems: unknown[], view: number[], styles: Record<string, { fontFamily?: string }> = {}): Paragraph[] {
  const items = rawItems.filter(isTextItem);
  const mono = new Set(Object.entries(styles).filter(([, s]) => /mono|courier|consol/i.test(s.fontFamily ?? "")).map(([name]) => name));
  const lines = buildLines(items, mono);
  if (!lines.length) return [];
  const heights = lines.map((l) => l.height).sort((a, b) => a - b);
  const typical = heights[Math.floor(heights.length / 2)] || 10;

  // The text column: a prose line ending a sentence well before its right edge ends its paragraph
  // (list items drawn without bullet characters, short paragraphs without extra spacing).
  const proseLines = lines.filter((l) => !l.mono && l.cells.length < 3);
  const bodyLeft = Math.min(...proseLines.map((l) => l.left));
  const rights = proseLines.map((l) => l.right).sort((a, b) => a - b);
  const bodyRight = rights[Math.floor(rights.length * 0.9)] ?? 0;
  const endsShort = (l: Line) => /[.!?؟:;]$/u.test(l.text) && l.right < bodyLeft + (bodyRight - bodyLeft) * 0.75;

  const [x0, y0, x1, y1] = view.length === 4 ? view : [0, 0, 612, 792];
  const width = x1 - x0 || 1;
  const height = y1 - y0 || 1;

  const paragraphs: Paragraph[] = [];
  let group: Line[] = [];
  let kind: ParagraphKind = "text";
  const flush = () => {
    if (!group.length) return;
    const text =
      kind === "code"
        ? indentedCode(group)
        : kind === "math"
          ? group.map((l) => l.text).join("\n")
          : kind === "table"
            ? group.map((l) => l.cells.join(" | ")).join("\n")
            : joinProse(group.map((l) => l.text));
    const left = Math.min(...group.map((l) => l.left));
    const right = Math.max(...group.map((l) => l.right));
    const top = Math.max(...group.map((l) => l.top));
    const bottom = Math.min(...group.map((l) => l.bottom));
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    paragraphs.push({
      text,
      kind,
      box: [clamp((left - x0) / width), clamp((y1 - top) / height), clamp((right - left) / width), clamp((top - bottom) / height)],
    });
    group = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const k = lineKind(line, typical);
    const prev = group.at(-1);
    let split = !prev;
    if (prev) {
      const gap = prev.y - line.y;
      const sameBlock = k === kind && (k === "code" || k === "table" || k === "math");
      // Table rows (with cell padding) and code or formula lines may sit further apart than prose lines.
      if (gap > typical * (sameBlock ? 3 : 1.8) || gap < -typical) split = true;
      else if (k !== kind && !(kind === "list" && k === "text")) split = true;
      else if (k === "list") split = !sameBlock;
      // k === kind === "heading": a heading wrapped onto a second line stays one paragraph.
      // A list item's wrapped continuation lines are indented text: keep them with the item.
      if (kind === "list" && k === "text" && gap <= typical * 1.8 && gap >= 0) split = false;
      if (!split && (kind === "text" || kind === "list") && k !== "list" && !prev.rtl && endsShort(prev)) split = true;
    }
    if (split) {
      flush();
      kind = k;
    }
    group.push(line);
  }
  flush();
  return paragraphs;
}

/** The page's plain text: paragraphs separated by blank lines. */
export function paragraphsText(paragraphs: Paragraph[]): string {
  return paragraphs.map((p) => p.text).join("\n\n");
}

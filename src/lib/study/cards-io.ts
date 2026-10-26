/*
 * Flashcards in and out: CSV that Anki and spreadsheets open (with Anki's
 * "#separator" header lines), and JSON. Imported cards are checked and
 * limited; only the front and back are taken.
 */
import type { Card } from "./store";

export const MAX_IMPORT_CARDS = 5000;

const quote = (s: string) => (/[",\n\r]/u.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function cardsCsv(cards: Pick<Card, "front" | "back">[]): string {
  return ["#separator:comma", "#html:false", "#columns:Front,Back", ...cards.map((c) => `${quote(c.front)},${quote(c.back)}`)].join("\n") + "\n";
}

export function cardsJson(cards: Pick<Card, "front" | "back" | "page">[]): string {
  return JSON.stringify({ cards: cards.map(({ front, back, page }) => ({ front, back, page })) }, null, 2);
}

/** Rows of a CSV or TSV text, honouring quoted fields with commas, quotes and line breaks. */
function parseDelimited(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === sep) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const HEADERS = new Set(["front", "question", "term", "الوجه", "السؤال", "المصطلح"]);

/** Cards from an exported (or hand-made) CSV, TSV or JSON file. Empty when nothing usable is found. */
export function parseCards(text: string): { front: string; back: string }[] {
  const body = text.replace(/^﻿/u, "").trim();
  let pairs: { front: unknown; back: unknown }[];
  if (body.startsWith("{") || body.startsWith("[")) {
    try {
      const data = JSON.parse(body) as unknown;
      const list = Array.isArray(data) ? data : (data as { cards?: unknown })?.cards;
      pairs = Array.isArray(list) ? list.filter((x): x is { front: unknown; back: unknown } => typeof x === "object" && x !== null) : [];
    } catch {
      return [];
    }
  } else {
    const lines = body.split(/\r?\n/u);
    const declared = /^#separator:(\w+)/iu.exec(lines.find((l) => l.startsWith("#separator:")) ?? "")?.[1]?.toLowerCase();
    const content = lines.filter((l) => !l.startsWith("#")).join("\n");
    const first = content.split("\n", 1)[0] ?? "";
    const sep = declared === "tab" ? "\t" : declared === "semicolon" ? ";" : declared === "comma" ? "," : first.includes("\t") ? "\t" : first.includes(";") && !first.includes(",") ? ";" : ",";
    const rows = parseDelimited(content, sep);
    if (rows.length && HEADERS.has(rows[0][0]?.trim().toLowerCase())) rows.shift();
    pairs = rows.map((r) => ({ front: r[0], back: r[1] }));
  }
  return pairs
    .filter((p) => typeof p.front === "string" && typeof p.back === "string")
    .map((p) => ({ front: (p.front as string).trim().slice(0, 2000), back: (p.back as string).trim().slice(0, 4000) }))
    .filter((p) => p.front && p.back)
    .slice(0, MAX_IMPORT_CARDS);
}

/*
 * Paragraph-aligned translation for the study workspace.
 *
 * - Code and formulas are never sent; their slot stays null.
 * - Glossary terms are replaced by [[n]] placeholders before translating (the
 *   translator leaves them untouched) and restored as the student's preferred
 *   translation, optionally with the original term in brackets.
 * - Paragraphs (of several pages at once) are joined with blank lines into
 *   requests of at most ~12,000 characters and split back afterwards; if the
 *   translator merges or splits paragraphs, that batch is redone one
 *   paragraph at a time, so translations always line up with their source.
 */
import { UNTRANSLATED_KINDS, type Paragraph } from "./layout";
import type { GlossaryEntry } from "./store";

const BATCH_CHARS = 12_000;

export type Translate = (text: string, target: string, signal?: AbortSignal) => Promise<string>;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replaces glossary terms (whole words, case-insensitive, longest first) with numbered placeholders. */
export function protectTerms(text: string, glossary: GlossaryEntry[]): { text: string; used: GlossaryEntry[] } {
  const used: GlossaryEntry[] = [];
  let out = text;
  for (const entry of glossary.slice().sort((a, b) => b.term.length - a.term.length)) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(entry.term)}(?![\\p{L}\\p{N}])`, "giu");
    if (!re.test(out)) continue;
    used.push(entry);
    out = out.replace(re, `[[${used.length}]]`);
  }
  return { text: out, used };
}

/** Puts the preferred translations back in place of the placeholders. */
export function restoreTerms(text: string, used: GlossaryEntry[]): string {
  return text.replace(/\[\[\s*([0-9٠-٩]+)\s*\]\]/gu, (match, digits: string) => {
    const n = Number(digits.replace(/[٠-٩]/gu, (d) => String(d.charCodeAt(0) - 0x0660)));
    const entry = used[n - 1];
    if (!entry) return match;
    // No preferred translation: the term stays in its original language.
    if (!entry.translation) return entry.term;
    return entry.showOriginal ? `${entry.translation} (${entry.term})` : entry.translation;
  });
}

async function translateBatch(texts: string[], target: string, glossary: GlossaryEntry[], translate: Translate, signal?: AbortSignal): Promise<string[]> {
  const { text, used } = protectTerms(texts.join("\n\n"), glossary);
  const out = restoreTerms(await translate(text, target, signal), used)
    .split(/\n\s*\n/u)
    .map((t) => t.trim());
  if (out.length === texts.length) return out;
  // Paragraphs merged or split: translate them one by one so they stay aligned.
  const single: string[] = [];
  for (const t of texts) {
    const p = protectTerms(t, glossary);
    single.push(restoreTerms(await translate(p.text, target, signal), p.used).replace(/\s*\n\s*\n\s*/gu, "\n").trim());
  }
  return single;
}

/**
 * Translates the paragraphs of several pages; returns, per page, one entry per
 * paragraph (null for code and formulas). `onBatch` reports pages finished so far.
 */
export async function translatePages(
  pages: Paragraph[][],
  { target, glossary, translate, signal, onBatch }: { target: string; glossary: GlossaryEntry[]; translate: Translate; signal?: AbortSignal; onBatch?: (pagesDone: number) => void },
): Promise<(string | null)[][]> {
  const result = pages.map((ps) => ps.map(() => null as string | null));
  // Work items: every translatable paragraph, with where its translation goes.
  const items = pages.flatMap((ps, p) => ps.map((para, i) => ({ p, i, text: para.text.trim(), kind: para.kind }))).filter((x) => x.text && !UNTRANSLATED_KINDS.has(x.kind));
  let start = 0;
  while (start < items.length) {
    let end = start;
    let size = 0;
    while (end < items.length && (end === start || size + items[end].text.length + 2 <= BATCH_CHARS)) size += items[end++].text.length + 2;
    const batch = items.slice(start, end);
    const out = await translateBatch(
      batch.map((b) => b.text),
      target,
      glossary,
      translate,
      signal,
    );
    batch.forEach((b, k) => (result[b.p][b.i] = out[k] ?? ""));
    onBatch?.(end < items.length ? items[end].p : pages.length);
    start = end;
  }
  if (!items.length) onBatch?.(pages.length);
  return result;
}

export class TranslateRequestError extends Error {
  constructor(readonly status: number) {
    super(`translate HTTP ${status}`);
  }
}

/** The app's translation API, waiting and retrying when it asks us to slow down. */
export const translateViaApi: Translate = async (text, target, signal) => {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "translate", text, source: "auto", target }),
      signal,
    });
    if (res.ok) return ((await res.json()) as { text: string }).text;
    if (res.status === 429 && attempt < 5) {
      const body = (await res.json().catch(() => ({}))) as { error?: { retryAfter?: number } };
      const wait = Math.min(60, body.error?.retryAfter ?? 5) * 1000;
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, wait);
        signal?.addEventListener("abort", () => (clearTimeout(t), reject(new DOMException("Aborted", "AbortError"))), { once: true });
      });
      continue;
    }
    throw new TranslateRequestError(res.status);
  }
};

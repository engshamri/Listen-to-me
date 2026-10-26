/*
 * Definitions stated in a lecture, found by sentence patterns ("X is a …",
 * "X is defined as …", "X refers to …", "يُعرّف X بأنه …", "X هو …", "X: …").
 * This is plain text matching, not AI: every definition is a sentence that is
 * in the lecture, with its page and paragraph, so it can always be checked.
 */
import { splitSentences } from "@/lib/text/chunk";
import type { Box, Paragraph } from "./layout";

export interface Definition {
  term: string;
  definition: string;
  /** The sentence as written in the lecture. */
  sentence: string;
  page: number;
  box: Box;
}

/** Subjects that are pronouns or vague words, not terms. */
const NOT_TERMS = new Set(
  "it this that these those there they he she we you i which what who one each all some most many both such another other its their here thus therefore however also then so".split(" "),
);
/** Discourse words that may open a definition sentence: "Here Km is …". */
const LEAD = /^(?:here|thus|therefore|in (?:this|biology|chemistry|physics|medicine|computing|general)|in short|formally|simply put|by definition|in other words),?\s+/iu;

const EN_PATTERNS: RegExp[] = [
  /^(?<term>[\p{L}\p{N}][\p{L}\p{N}\s()/'’-]{0,60}?)\s+(?:is|are)\s+defined\s+as\s+(?<def>.+)$/iu,
  /^(?<term>[\p{L}\p{N}][\p{L}\p{N}\s()/'’-]{0,60}?)\s+(?:refers?|refer)\s+to\s+(?<def>.+)$/iu,
  /^(?<term>[\p{L}\p{N}][\p{L}\p{N}\s()/'’-]{0,60}?)\s+(?:means|denotes)\s+(?<def>.+)$/iu,
  /^(?<term>[\p{L}\p{N}][\p{L}\p{N}\s()/'’-]{0,60}?)\s+(?:is|are)\s+(?<def>(?:a|an|the|one|any)\s+.+)$/iu,
  // Plurals rarely take an article: "Enzymes are biological catalysts that …" (the relative clause marks a definition).
  /^(?<term>[\p{L}\p{N}][\p{L}\p{N}\s()/'’-]{0,60}?)\s+(?:is|are)\s+(?<def>[\p{L}-]+(?:\s+[\p{L}-]+){0,4}\s+(?:that|which|who|whose|used|where|in which)\s.+)$/iu,
  /^(?<term>[\p{L}\p{N}][\p{L}\p{N}\s()/'’-]{0,40}?)\s*:\s+(?<def>.+)$/iu,
];

/** Matched on the text without diacritics (يُعرَّف = يعرف). */
const AR_PATTERNS: RegExp[] = [
  /^و?(?:يعرف|تعرف)\s+(?<term>[^\s،.:]+(?:\s+[^\s،.:]+){0,4}?)\s+(?:بأنه|بأنها|على أنه|على أنها)\s+(?<def>.+)$/u,
  /^و?(?:يقصد|يراد)\s+(?:بـ\s*|ب)(?<term>[^\s،.:]+(?:\s+[^\s،.:]+){0,4}?)\s+(?<def>.+)$/u,
  /^(?<term>[^\s،.:]+(?:\s+[^\s،.:]+){0,4}?)\s+(?:هو|هي|هم)\s+(?<def>.+)$/u,
  /^(?<term>[^\s،.:]+(?:\s+[^\s،.:]+){0,3}?)\s*:\s+(?<def>.+)$/u,
];

function clean(s: string): string {
  return s.replace(/\s+/gu, " ").replace(/[\s,;:،؛]+$/u, "").trim();
}

function acceptable(term: string, def: string): boolean {
  const words = term.split(/\s+/u);
  if (!/^\p{L}/u.test(term) || words.length > 6 || term.length > 60) return false;
  if (NOT_TERMS.has(words[0].toLowerCase())) return false;
  if (def.length < 15 || def.length > 320) return false;
  // "X is not …", "X is also …": not a definition.
  if (/^(?:not|also|often|usually|very|more|less|then|now|still)\b/iu.test(def)) return false;
  return true;
}

/** Finds definitions in one sentence; null when the sentence doesn't define anything. */
export function matchDefinition(sentence: string): { term: string; definition: string } | null {
  const s = clean(clean(sentence).replace(/[.!?؟]+$/u, ""));
  const arabic = /\p{Script=Arabic}/u.test(s.slice(0, 20));
  const patterns = arabic ? AR_PATTERNS : EN_PATTERNS;
  const text = arabic ? s.replace(/[ً-ْٰ]/gu, "") : s.replace(LEAD, "");
  for (const re of patterns) {
    const m = re.exec(text);
    if (!m?.groups) continue;
    const term = clean(m.groups.term.replace(/^(?:the|a|an)\s+/iu, ""));
    const definition = clean(m.groups.def);
    if (acceptable(term, definition)) return { term, definition };
  }
  return null;
}

/** All definitions in a lecture's pages, first occurrence of each term kept. */
export function findDefinitions(pages: { page: number; paragraphs: Paragraph[] }[], locale = "en"): Definition[] {
  const out: Definition[] = [];
  const seen = new Set<string>();
  for (const { page, paragraphs } of pages) {
    for (const p of paragraphs) {
      if (p.kind === "code" || p.kind === "math" || p.kind === "table" || p.kind === "heading") continue;
      for (const sentence of splitSentences(p.text, /\p{Script=Arabic}/u.test(p.text) ? "ar" : locale)) {
        const found = matchDefinition(sentence);
        if (!found) continue;
        const key = found.term.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...found, sentence: sentence.trim(), page, box: p.box });
      }
    }
  }
  return out;
}

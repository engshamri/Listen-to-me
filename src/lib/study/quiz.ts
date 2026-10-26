/*
 * Practice questions built from the definitions stated in a lecture (see
 * definitions.ts). No AI: every question, answer and explanation is the
 * lecture's own sentence, with its page, so answers are right by construction.
 * Distractors are other terms defined in the same lecture.
 */
import { normalizeForSearch } from "@/lib/text/search";
import type { Definition } from "./definitions";
import type { Box } from "./layout";

export type QuestionKind = "mcq-term" | "mcq-definition" | "true-false" | "fill-blank" | "matching";
export type Difficulty = "easy" | "medium" | "hard";

export const KINDS_BY_DIFFICULTY: Record<Difficulty, QuestionKind[]> = {
  easy: ["mcq-term", "true-false"],
  medium: ["mcq-term", "mcq-definition", "true-false", "fill-blank"],
  hard: ["fill-blank", "mcq-definition", "matching"],
};

interface Base {
  id: string;
  /** The source: page and paragraph, and the sentence the question comes from. */
  page: number;
  box: Box;
  source: string;
}

export type Question =
  | (Base & { kind: "mcq-term"; definition: string; options: string[]; answer: string })
  | (Base & { kind: "mcq-definition"; term: string; options: string[]; answer: string })
  | (Base & { kind: "true-false"; term: string; definition: string; answer: boolean; correctDefinition: string })
  | (Base & { kind: "fill-blank"; prompt: string; answer: string })
  | (Base & { kind: "matching"; terms: string[]; definitions: string[]; answer: Record<string, string>; sources: { term: string; page: number }[] });

export type Answer = string | boolean | Record<string, string> | null;

/** A small seeded random generator (mulberry32), so a quiz can be rebuilt exactly. */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rnd: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const same = (a: string, b: string) => normalizeForSearch(a) === normalizeForSearch(b);

/** Other definitions to use as wrong options: distinct terms and definitions. */
function others(def: Definition, all: Definition[], count: number, rnd: () => number): Definition[] {
  const pool = all.filter((d) => !same(d.term, def.term) && !same(d.definition, def.definition));
  return shuffle(pool, rnd).slice(0, count);
}

/** The definition sentence with the term blanked, when the sentence names the term. */
function blanked(def: Definition): string | null {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${def.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu");
  if (!re.test(def.sentence)) return null;
  return def.sentence.replace(re, "_____");
}

/** Questions that a set of definitions supports, in each requested kind. */
function canMake(kind: QuestionKind, total: number): boolean {
  if (kind === "mcq-term" || kind === "mcq-definition") return total >= 4;
  if (kind === "true-false") return total >= 2;
  if (kind === "matching") return total >= 4;
  return total >= 1;
}

export function makeQuiz(definitions: Definition[], { count, kinds, seed = Date.now() }: { count: number; kinds: QuestionKind[]; seed?: number }): Question[] {
  const rnd = random(seed);
  const usable = kinds.filter((k) => canMake(k, definitions.length));
  if (!usable.length) return [];
  const queue = shuffle(definitions, rnd);
  const questions: Question[] = [];
  let k = 0;
  while (questions.length < count && queue.length) {
    const kind = usable[k++ % usable.length];
    if (kind === "matching") {
      if (queue.length < 4) {
        if (usable.length === 1) break;
        continue;
      }
      const group = queue.splice(0, 4);
      questions.push({
        id: `q${questions.length + 1}`,
        kind,
        page: group[0].page,
        box: group[0].box,
        source: group.map((d) => d.sentence).join(" "),
        terms: group.map((d) => d.term),
        definitions: shuffle(
          group.map((d) => d.definition),
          rnd,
        ),
        answer: Object.fromEntries(group.map((d) => [d.term, d.definition])),
        sources: group.map((d) => ({ term: d.term, page: d.page })),
      });
      continue;
    }
    const def = queue.shift()!;
    const base = { id: `q${questions.length + 1}`, page: def.page, box: def.box, source: def.sentence };
    if (kind === "mcq-term") {
      const wrong = others(def, definitions, 3, rnd).map((d) => d.term);
      questions.push({ ...base, kind, definition: def.definition, options: shuffle([def.term, ...wrong], rnd), answer: def.term });
    } else if (kind === "mcq-definition") {
      const wrong = others(def, definitions, 3, rnd).map((d) => d.definition);
      questions.push({ ...base, kind, term: def.term, options: shuffle([def.definition, ...wrong], rnd), answer: def.definition });
    } else if (kind === "true-false") {
      const truth = rnd() < 0.5;
      const other = others(def, definitions, 1, rnd)[0];
      const shown = truth || !other ? def.definition : other.definition;
      questions.push({ ...base, kind, term: def.term, definition: shown, answer: truth || !other, correctDefinition: def.definition });
    } else {
      const prompt = blanked(def);
      if (!prompt) {
        // This sentence doesn't name its term in a blankable way: ask for the term instead.
        questions.push({ ...base, kind: "fill-blank", prompt: `_____ : ${def.definition}`, answer: def.term });
      } else {
        questions.push({ ...base, kind, prompt, answer: def.term });
      }
    }
  }
  return questions;
}

/** Compares a typed answer with the term, ignoring case, diacritics, articles and spacing. */
export function sameTerm(given: string, answer: string): boolean {
  const norm = (s: string) =>
    normalizeForSearch(s)
      .replace(/^(?:(?:the|a|an)\s+|ال)/u, "")
      .replace(/[^\p{L}\p{N}]+/gu, "");
  return norm(given) !== "" && norm(given) === norm(answer);
}

export function isCorrect(q: Question, given: Answer): boolean {
  if (given === null) return false;
  switch (q.kind) {
    case "mcq-term":
    case "mcq-definition":
      return given === q.answer;
    case "true-false":
      return given === q.answer;
    case "fill-blank":
      return typeof given === "string" && sameTerm(given, q.answer);
    case "matching":
      return typeof given === "object" && q.terms.every((t) => (given as Record<string, string>)[t] === q.answer[t]);
  }
}

export function score(questions: Question[], answers: Record<string, Answer>): { correct: number; total: number; percent: number } {
  const correct = questions.filter((q) => isCorrect(q, answers[q.id] ?? null)).length;
  return { correct, total: questions.length, percent: questions.length ? Math.round((correct / questions.length) * 100) : 0 };
}

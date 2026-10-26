import { describe, expect, it } from "vitest";
import type { Definition } from "@/lib/study/definitions";
import { KINDS_BY_DIFFICULTY, isCorrect, makeQuiz, sameTerm, score, type Question } from "@/lib/study/quiz";
import { isDue, newSrs, schedule } from "@/lib/study/srs";

const d = (term: string, definition: string, page: number): Definition => ({ term, definition, sentence: `${term} is ${definition}.`, page, box: [0, page / 10, 1, 0.05] });
const defs = [
  d("Enzymes", "biological catalysts that speed up chemical reactions", 1),
  d("Km", "the substrate concentration at which the velocity is half of Vmax", 2),
  d("Osmosis", "the movement of water across a semi-permeable membrane", 3),
  d("Homeostasis", "the maintenance of a stable internal environment", 4),
  d("ATP", "the main energy currency of the cell", 5),
  d("Mitochondria", "the organelles where cellular respiration happens", 6),
];

describe("makeQuiz", () => {
  it("builds the requested number of questions, each from a different definition, with correct answers", () => {
    const qs = makeQuiz(defs, { count: 5, kinds: KINDS_BY_DIFFICULTY.medium, seed: 7 });
    expect(qs).toHaveLength(5);
    expect(new Set(qs.map((q) => q.source)).size).toBe(5);
    for (const q of qs) {
      const def = defs.find((x) => x.sentence === q.source)!;
      expect(q.page).toBe(def.page);
      if (q.kind === "mcq-term") {
        expect(q.answer).toBe(def.term);
        expect(q.options).toHaveLength(4);
        expect(new Set(q.options).size).toBe(4);
        expect(q.options).toContain(def.term);
      } else if (q.kind === "mcq-definition") {
        expect(q.answer).toBe(def.definition);
        expect(new Set(q.options).size).toBe(4);
      } else if (q.kind === "true-false") {
        expect(q.answer).toBe(q.definition === def.definition);
        expect(q.correctDefinition).toBe(def.definition);
      } else if (q.kind === "fill-blank") {
        expect(q.prompt).toContain("_____");
        expect(q.prompt).not.toContain(def.term);
        expect(q.answer).toBe(def.term);
      }
    }
  });

  it("is reproducible from its seed", () => {
    expect(makeQuiz(defs, { count: 4, kinds: ["mcq-term"], seed: 3 })).toEqual(makeQuiz(defs, { count: 4, kinds: ["mcq-term"], seed: 3 }));
  });

  it("matching questions pair four terms with their definitions", () => {
    const [q] = makeQuiz(defs, { count: 1, kinds: ["matching"], seed: 1 }) as Extract<Question, { kind: "matching" }>[];
    expect(q.terms).toHaveLength(4);
    for (const t of q.terms) expect(q.definitions).toContain(q.answer[t]);
    expect(isCorrect(q, q.answer)).toBe(true);
    const wrong = { ...q.answer, [q.terms[0]]: q.answer[q.terms[1]] };
    expect(isCorrect(q, wrong)).toBe(false);
  });

  it("uses only the kinds the definitions allow (multiple choice needs 4)", () => {
    const qs = makeQuiz(defs.slice(0, 2), { count: 5, kinds: ["mcq-term", "true-false", "fill-blank"], seed: 2 });
    expect(qs).toHaveLength(2);
    expect(qs.every((q) => q.kind !== "mcq-term")).toBe(true);
    expect(makeQuiz([], { count: 5, kinds: ["mcq-term"] })).toEqual([]);
  });

  it("scores answers; typed terms ignore case, articles and diacritics", () => {
    expect(sameTerm("enzymes", "Enzymes")).toBe(true);
    expect(sameTerm("the ATP", "ATP")).toBe(true);
    expect(sameTerm("الإنزيمات", "الانزيمات")).toBe(true);
    expect(sameTerm("", "ATP")).toBe(false);
    const qs = makeQuiz(defs, { count: 3, kinds: ["fill-blank"], seed: 5 });
    const answers = { [qs[0].id]: (qs[0] as { answer: string }).answer.toUpperCase(), [qs[1].id]: "wrong" };
    expect(score(qs, answers)).toEqual({ correct: 1, total: 3, percent: 33 });
  });
});

describe("spaced repetition (SM-2)", () => {
  const now = Date.UTC(2026, 9, 26);
  const day = 86_400_000;

  it("spaces known cards further apart and brings forgotten ones back soon", () => {
    let s = newSrs(now);
    expect(isDue(s, now)).toBe(true);
    s = schedule(s, "medium", now);
    expect(s.interval).toBe(1);
    s = schedule(s, "medium", now + day);
    expect(s.interval).toBe(6);
    s = schedule(s, "medium", now + 7 * day);
    expect(s.interval).toBe(15); // 6 × 2.5
    expect(isDue(s, now + 8 * day)).toBe(false);

    const forgotten = schedule(s, "again", now + 22 * day);
    expect(forgotten.interval).toBe(0);
    expect(forgotten.reps).toBe(0);
    expect(forgotten.lapses).toBe(1);
    expect(forgotten.due - (now + 22 * day)).toBe(10 * 60_000);
    expect(forgotten.ease).toBeLessThan(s.ease);
  });

  it("easy grows faster than hard, and the ease never drops below 1.3", () => {
    const base = schedule(schedule(newSrs(now), "medium", now), "medium", now);
    expect(schedule(base, "easy", now).interval).toBeGreaterThan(schedule(base, "hard", now).interval);
    let s = newSrs(now);
    for (let i = 0; i < 20; i++) s = schedule(s, "again", now);
    expect(s.ease).toBe(1.3);
  });
});

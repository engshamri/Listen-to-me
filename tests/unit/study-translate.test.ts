import { describe, expect, it, vi } from "vitest";
import { notesMarkdown, translationMarkdown, type ExportLabels } from "@/lib/study/export";
import type { Paragraph } from "@/lib/study/layout";
import type { Annotation, GlossaryEntry, StudyPage } from "@/lib/study/store";
import { protectTerms, restoreTerms, translatePages, type Translate } from "@/lib/study/translate";

const p = (text: string, kind: Paragraph["kind"] = "text"): Paragraph => ({ text, kind, box: [0, 0, 1, 0.1] });
const g = (term: string, translation: string, showOriginal = false): GlossaryEntry => ({ id: term, term, translation, showOriginal, note: "", createdAt: 0 });

/** A fake translator: prefixes every paragraph with "AR:" and keeps placeholders. */
const fake: Translate = async (text) =>
  text
    .split("\n\n")
    .map((t) => `AR:${t}`)
    .join("\n\n");

describe("glossary protection", () => {
  it("replaces whole-word terms (longest first) and restores the preferred translations", () => {
    const glossary = [g("cell", "خلية"), g("cell membrane", "الغشاء الخلوي", true), g("ATP", "")];
    const { text, used } = protectTerms("The cell membrane surrounds the cell. Cells make ATP; cellular parts too.", glossary);
    expect(text).toBe("The [[1]] surrounds the [[2]]. Cells make [[3]]; cellular parts too.");
    expect(restoreTerms("يحيط [[1]] بـ[[ 2 ]] وتصنع الخلايا [[٣]].", used)).toBe("يحيط الغشاء الخلوي (cell membrane) بـخلية وتصنع الخلايا ATP.");
  });
});

describe("translatePages", () => {
  it("keeps translations aligned with paragraphs across pages, skipping code and formulas", async () => {
    const translate = vi.fn(fake);
    const pages = [[p("Cells divide."), p("x = y + 1", "math")], [p("def f(): pass", "code"), p("Enzymes are proteins.")]];
    const done: number[] = [];
    const out = await translatePages(pages, { target: "ar", glossary: [g("Enzymes", "الإنزيمات")], translate, onBatch: (n) => done.push(n) });
    expect(out).toEqual([["AR:Cells divide.", null], [null, "AR:الإنزيمات are proteins."]]);
    // One request for both pages.
    expect(translate).toHaveBeenCalledTimes(1);
    expect(translate.mock.calls[0][0]).toBe("Cells divide.\n\n[[1]] are proteins.");
    expect(done.at(-1)).toBe(2);
  });

  it("redoes a batch paragraph by paragraph when the translator merges paragraphs", async () => {
    const merging: Translate = vi.fn(async (text: string) => (text.includes("\n\n") ? "AR:all in one" : `AR:${text}`));
    const out = await translatePages([[p("One."), p("Two.")]], { target: "ar", glossary: [], translate: merging });
    expect(out).toEqual([["AR:One.", "AR:Two."]]);
    expect(merging).toHaveBeenCalledTimes(3);
  });

  it("splits long lectures into several requests", async () => {
    const translate = vi.fn(fake);
    const long = "word ".repeat(1500).trim(); // 7,499 characters
    await translatePages([[p(long), p(long), p(long)]], { target: "ar", glossary: [], translate });
    expect(translate).toHaveBeenCalledTimes(3);
  });
});

const labels: ExportLabels = { page: (n) => `Page ${n}`, ocr: (c) => `OCR ${c}%`, notTranslated: "Not translated", bookmark: "Bookmark" };

describe("exports", () => {
  it("exports translations with page references, quoting the original", () => {
    const pages: StudyPage[] = [
      { docId: "d", page: 1, source: "text", paragraphs: [p("Cells divide."), p("x = y", "math")], translations: { ar: { paragraphs: ["تنقسم الخلايا.", null], provider: "G", at: 0 } } },
      { docId: "d", page: 2, source: "text", paragraphs: [p("Not translated yet.")] },
      { docId: "d", page: 3, source: "ocr", confidence: 64.4, paragraphs: [p("Scanned text.")], translations: { ar: { paragraphs: ["نص ممسوح."], provider: "G", at: 0 } } },
    ];
    expect(translationMarkdown("Biology 1", pages, "ar", labels)).toBe(
      "# Biology 1\n\n## Page 1\n\n> Cells divide.\n\nتنقسم الخلايا.\n\n```\nx = y\n```\n\n*Not translated*\n\n## Page 3 (OCR 64%)\n\n> Scanned text.\n\nنص ممسوح.\n",
    );
  });

  it("exports notes, highlights and bookmarks by page", () => {
    const a = (page: number, kind: Annotation["kind"], quote: string, note: string): Annotation => ({ id: `${page}${kind}`, docId: "d", page, kind, color: "yellow", quote, rects: [], note, createdAt: 0, updatedAt: 0 });
    expect(notesMarkdown("Biology 1", [a(3, "highlight", "Enzymes are proteins.", "Exam!"), a(1, "bookmark", "", "Start")], labels)).toBe(
      "# Biology 1\n\n## Page 1\n\n- **Bookmark**: Start\n\n## Page 3\n\n- > Enzymes are proteins.\n  Exam!\n",
    );
  });
});

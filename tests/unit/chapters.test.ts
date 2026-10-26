import { describe, expect, it } from "vitest";
import { chapterStarts, chaptersText, detectChapters } from "@/lib/text/chapters";

const titles = (text: string) => detectChapters(text).map((c) => c.title);
const para = "Plants turn light into chemical energy, and chlorophyll absorbs mostly red and blue light.";

describe("detectChapters", () => {
  it("finds Markdown headings; their ranges cover the whole text", () => {
    const text = `# Cells\n\n${para}\n\n## Membranes\n\n${para}\n\n## Transport\n\n${para}`;
    const chapters = detectChapters(text);
    expect(chapters.map((c) => c.title)).toEqual(["Cells", "Membranes", "Transport"]);
    expect(chapters[0].from).toBe(0);
    expect(chapters.at(-1)!.to).toBe(text.length);
    chapters.slice(1).forEach((c, i) => expect(c.from).toBe(chapters[i].to));
    expect(text.slice(chapters[1].from, chapters[1].to).trim()).toBe(`## Membranes\n\n${para}`);
  });

  it("finds lesson, chapter and lecture lines in English and Arabic", () => {
    expect(titles(`Lesson 1: Cells\n${para}\n\nLesson 2: Energy\n${para}`)).toEqual(["Lesson 1: Cells", "Lesson 2: Energy"]);
    expect(titles(`CHAPTER IV\n\n${para}\n\nChapter V\n\n${para}`)).toEqual(["CHAPTER IV", "Chapter V"]);
    expect(titles(`الدرس الأول: الخلية\n${para}\n\nالدرس الثاني: الطاقة\n${para}`)).toEqual(["الدرس الأول: الخلية", "الدرس الثاني: الطاقة"]);
    expect(titles(`المحاضرة 1\n\n${para}\n\nالمحاضرة 2\n\n${para}`)).toEqual(["المحاضرة 1", "المحاضرة 2"]);
  });

  it("finds numbered headings standing on their own line", () => {
    expect(titles(`1. Introduction\n\n${para}\n\n2. Methods\n\n${para}\n\n2.1 Sampling\n\n${para}`)).toEqual(["1. Introduction", "2. Methods", "2.1 Sampling"]);
  });

  it("does not treat sentences, list items or plain prose as headings", () => {
    // A sentence that happens to start with "Chapter 1".
    expect(titles(`Chapter 1 explains how plants turn light into chemical energy in great detail.\n\n${para}\n\nChapter 2 covers respiration and how cells release that energy again later.`)).toEqual([]);
    // A numbered list (no blank lines between items).
    expect(titles(`Steps:\n1. Mix the solution\n2. Heat it gently\n3. Record the colour\n\n${para}`)).toEqual([]);
    expect(titles(`${para}\n\n${para}\n\n${para}`)).toEqual([]);
    expect(titles("")).toEqual([]);
  });

  it("uses short standalone lines only when there are no clearer headings", () => {
    expect(titles(`Photosynthesis\n\n${para}\n\nRespiration\n\n${para}`)).toEqual(["Photosynthesis", "Respiration"]);
    // With a real heading style present, short lines stay body text.
    expect(titles(`# Plants\n\nPhotosynthesis\n\n${para}\n\n# Animals\n\n${para}`)).toEqual(["Plants", "Animals"]);
  });

  it("joins headings with nothing between them", () => {
    expect(titles(`# Part 1\n\n## Chapter 1\n\n${para}\n\n## Chapter 2\n\n${para}`)).toEqual(["Part 1 · Chapter 1", "Chapter 2"]);
  });

  it("keeps a real introduction as its own chapter, but folds a short document title into the first one", () => {
    const intro = "These notes summarise the first term of biology, from cells to ecosystems, with key definitions.";
    const withIntro = detectChapters(`${intro}\n\n# Cells\n\n${para}\n\n# Energy\n\n${para}`);
    expect(withIntro.map((c) => c.title)).toEqual(["", "Cells", "Energy"]);
    const withTitle = detectChapters(`Biology notes\n\n# Cells\n\n${para}\n\n# Energy\n\n${para}`);
    expect(withTitle.map((c) => c.title)).toEqual(["Cells", "Energy"]);
    expect(withTitle[0].from).toBe(0);
  });
});

describe("chaptersText and chapterStarts", () => {
  const text = `# A\n\nFirst part.\n\n# B\n\nSecond part.\n\n# C\n\nThird part.`;
  const chapters = detectChapters(text);

  it("joins chosen chapters in document order", () => {
    expect(chaptersText(text, chapters, [2, 0])).toBe("# A\n\nFirst part.\n\n# C\n\nThird part.");
    expect(chaptersText(text, chapters, [])).toBe("");
  });

  it("maps chapters to the start of their first sentence, null when not generated", () => {
    const at = (s: string) => text.indexOf(s);
    const sentences = [
      { from: at("# A"), to: at("First"), start: 0, end: 0.5 },
      { from: at("First"), to: at("# B"), start: 0.5, end: 1.5 },
      { from: at("# B"), to: at("Second"), start: 1.5, end: 2 },
      { from: at("Second"), to: at("# C"), start: 2, end: 3 },
    ];
    expect(chapterStarts(chapters, sentences)).toEqual([0, 1.5, null]);
  });
});

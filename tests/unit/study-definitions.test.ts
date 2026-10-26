import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { findDefinitions, matchDefinition } from "@/lib/study/definitions";
import { pageParagraphs } from "@/lib/study/layout";

describe("matchDefinition", () => {
  it.each([
    ["Enzymes are biological catalysts that speed up chemical reactions.", "Enzymes", "biological catalysts that speed up chemical reactions"],
    ["Here Km is the substrate concentration at which the velocity is half of Vmax.", "Km", "the substrate concentration at which the velocity is half of Vmax"],
    ["Osmosis is defined as the movement of water across a membrane.", "Osmosis", "the movement of water across a membrane"],
    ["Homeostasis refers to the maintenance of a stable internal environment.", "Homeostasis", "the maintenance of a stable internal environment"],
    ["The cell membrane is a lipid bilayer that surrounds the cell.", "cell membrane", "a lipid bilayer that surrounds the cell"],
    ["ATP: the main energy currency of every living cell.", "ATP", "the main energy currency of every living cell"],
    ["يُعرّف التنفس الخلوي بأنه عملية إنتاج الطاقة في الخلية.", "التنفس الخلوي", "عملية إنتاج الطاقة في الخلية"],
    ["ويُقصد بالانتشار حركة الجزيئات من التركيز الأعلى إلى الأقل.", "الانتشار", "حركة الجزيئات من التركيز الأعلى إلى الأقل"],
    ["الميتوكوندريا هي مصنع الطاقة في الخلية الحية.", "الميتوكوندريا", "مصنع الطاقة في الخلية الحية"],
  ])("%s", (sentence, term, definition) => {
    expect(matchDefinition(sentence)).toEqual({ term, definition });
  });

  it.each([
    "It is a protein that binds oxygen in the blood.",
    "They are specific to their substrate.",
    "The enzyme is not active at a low pH value.",
    "Most enzymes are proteins, and each one has an active site.",
    "There are three types of muscle tissue in the body.",
    "Enzymes speed up reactions.",
  ])("not a definition: %s", (sentence) => {
    expect(matchDefinition(sentence)).toBeNull();
  });
});

describe("findDefinitions on the lecture fixture", () => {
  it("finds the definitions on their pages, once per term", async () => {
    const data = new Uint8Array(readFileSync(join(__dirname, "..", "fixtures", "lecture-enzymes.pdf")));
    const doc = await pdfjs.getDocument({ data, disableFontFace: true }).promise;
    const pages: { page: number; paragraphs: ReturnType<typeof pageParagraphs> }[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push({ page: n, paragraphs: pageParagraphs(content.items, page.view, content.styles) });
    }
    await doc.loadingTask.destroy();
    const defs = findDefinitions(pages);
    expect(defs.map((d) => [d.term, d.page])).toEqual(
      expect.arrayContaining([
        ["Enzymes", 1],
        ["Km", 2],
      ]),
    );
    const km = defs.find((d) => d.term === "Km")!;
    expect(km.sentence).toBe("Here Km is the substrate concentration at which the velocity is half of Vmax.");
    expect(km.box[1]).toBeGreaterThan(0);
    expect(new Set(defs.map((d) => d.term.toLowerCase())).size).toBe(defs.length);
  });
});

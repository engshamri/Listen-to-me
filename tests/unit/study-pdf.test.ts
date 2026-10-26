import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { pageParagraphs, type Paragraph } from "@/lib/study/layout";

/*
 * The layout analysis on a real PDF (tests/fixtures/lecture-enzymes.pdf, made
 * by scripts/make-test-lecture.mjs with Chromium's PDF printer), read with the
 * same pdf.js the browser uses.
 */

let pages: Paragraph[][] = [];

beforeAll(async () => {
  const data = new Uint8Array(readFileSync(join(__dirname, "..", "fixtures", "lecture-enzymes.pdf")));
  const doc = await pdfjs.getDocument({ data, disableFontFace: true }).promise;
  pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    pages.push(pageParagraphs(content.items, page.view, content.styles));
  }
  await doc.loadingTask.destroy();
});

const summary = (ps: Paragraph[]) => ps.map((p) => [p.kind, p.text]);

describe("layout of a real lecture PDF", () => {
  it("page 1: heading, two paragraphs, a heading and three list items drawn without bullet characters", () => {
    expect(summary(pages[0])).toEqual([
      ["heading", "Lecture 3: Enzymes and Metabolism"],
      ["text", "Enzymes are biological catalysts that speed up chemical reactions in living cells without being consumed. Most enzymes are proteins, and each one has an active site that binds a specific substrate."],
      ["text", "The rate of an enzyme-catalysed reaction depends on temperature, pH, and the concentration of the substrate. Above the optimum temperature, the enzyme denatures and loses its shape."],
      ["heading", "Key properties"],
      ["text", "Enzymes lower the activation energy of a reaction."],
      ["text", "They are specific to their substrate."],
      ["text", "They can be inhibited by competitive and non-competitive inhibitors."],
    ]);
  });

  it("page 2: formula, table rows with their cells and code with its indentation stay intact", () => {
    const ps = pages[1];
    expect(ps.find((p) => p.kind === "math")?.text).toBe("v = Vmax × [S] / (Km + [S])");
    expect(ps.find((p) => p.kind === "table")?.text).toBe("Enzyme | Substrate | Km (mM)\nHexokinase | Glucose | 0.15\nCatalase | H2O2 | 25");
    expect(ps.find((p) => p.kind === "code")?.text).toBe("def velocity(vmax, km, s):\n    return vmax * s / (km + s)");
  });

  it("page 3: Arabic paragraphs in reading order", () => {
    expect(pages[2].map((p) => p.text)).toEqual([
      "الإنزيمات في الجسم",
      "الإنزيمات بروتينات تسرّع التفاعلات الكيميائية في الخلايا الحية دون أن تُستهلك. ولكل إنزيم موقع نشط يرتبط بمادة متفاعلة محددة.",
      "تتأثر سرعة التفاعل الإنزيمي بدرجة الحرارة ودرجة الحموضة وتركيز المادة المتفاعلة.",
    ]);
  });

  it("page 4 (scanned) has no text layer; page 5 has text again", () => {
    expect(pages[3]).toEqual([]);
    expect(pages[4][0]).toMatchObject({ kind: "heading", text: "Summary" });
  });

  it("paragraph boxes lie on the page, top to bottom", () => {
    for (const ps of pages) {
      for (const p of ps) {
        const [left, top, width, height] = p.box;
        expect(left).toBeGreaterThanOrEqual(0);
        expect(top).toBeGreaterThanOrEqual(0);
        expect(left + width).toBeLessThanOrEqual(1);
        expect(top + height).toBeLessThanOrEqual(1);
      }
      for (let i = 1; i < ps.length; i++) expect(ps[i].box[1]).toBeGreaterThan(ps[i - 1].box[1]);
    }
  });
});

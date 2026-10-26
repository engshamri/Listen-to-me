import { describe, expect, it } from "vitest";
import { looksLikeMath, pageParagraphs, paragraphsText } from "@/lib/study/layout";

/** A pdf.js text item: `str` at (x, baseline y), font height h, width ≈ 0.5·h per character. */
function item(str: string, x: number, y: number, { h = 10, font = "F1", eol = false, w }: { h?: number; font?: string; eol?: boolean; w?: number } = {}) {
  return { str, dir: "ltr", transform: [h, 0, 0, h, x, y], width: w ?? str.length * h * 0.5, height: h, fontName: font, hasEOL: eol };
}
const VIEW = [0, 0, 600, 800];

describe("pageParagraphs", () => {
  it("joins wrapped lines into paragraphs and splits at blank space, with boxes on the page", () => {
    const items = [
      item("Photosynthesis turns light into", 50, 700, { eol: true }),
      item("chemical energy in chloro-", 50, 688, { eol: true }),
      item("plasts of plant cells.", 50, 676, { eol: true }),
      item("Respiration releases it again.", 50, 640, { eol: true }),
    ];
    const ps = pageParagraphs(items, VIEW);
    expect(ps.map((p) => p.text)).toEqual(["Photosynthesis turns light into chemical energy in chloroplasts of plant cells.", "Respiration releases it again."]);
    expect(ps.map((p) => p.kind)).toEqual(["text", "text"]);
    const [left, top, width, height] = ps[0].box;
    expect(left).toBeCloseTo(50 / 600);
    expect(top).toBeCloseTo((800 - 710) / 800);
    expect(width).toBeGreaterThan(0.2);
    expect(top + height).toBeCloseTo((800 - (676 - 2.5)) / 800);
    expect(paragraphsText(ps)).toBe(`${ps[0].text}\n\n${ps[1].text}`);
  });

  it("keeps headings, list items, code and formulas apart", () => {
    const items = [
      item("Chapter 2: Enzymes", 50, 740, { h: 18, eol: true }),
      item("Enzymes speed up reactions in cells.", 50, 712, { eol: true }),
      item("• They are proteins", 60, 698, { eol: true }),
      item("• They have an active site", 60, 686, { eol: true }),
      item("  that binds the substrate", 70, 674, { eol: true }),
      item("rate = k[E][S]", 50, 640, { eol: true }),
      item("def km(vmax, s):", 50, 610, { font: "Mono", eol: true }),
      item("    return vmax * s", 50, 598, { font: "Mono", eol: true }),
    ];
    const ps = pageParagraphs(items, VIEW, { Mono: { fontFamily: "monospace" }, F1: { fontFamily: "sans-serif" } });
    expect(ps.map((p) => [p.kind, p.text])).toEqual([
      ["heading", "Chapter 2: Enzymes"],
      ["text", "Enzymes speed up reactions in cells."],
      ["list", "• They are proteins"],
      ["list", "• They have an active site that binds the substrate"],
      ["math", "rate = k[E][S]"],
      ["code", "def km(vmax, s):\nreturn vmax * s"],
    ]);
  });

  it("keeps table rows with their cells", () => {
    const items = [
      item("Drug", 50, 700), item("Dose", 200, 700), item("Route", 350, 700, { eol: true }),
      item("Aspirin", 50, 686), item("75 mg", 200, 686), item("Oral", 350, 686, { eol: true }),
    ];
    const ps = pageParagraphs(items, VIEW);
    expect(ps).toHaveLength(1);
    expect(ps[0].kind).toBe("table");
    expect(ps[0].text).toBe("Drug | Dose | Route\nAspirin | 75 mg | Oral");
  });

  it("orders Arabic lines right to left even when drawn left to right", () => {
    const items = [item("الخلية", 300, 700, { w: 40 }), item("هي", 345, 700, { w: 15 }), item("الوحدة", 365, 700, { w: 40, eol: true })];
    // Drawn left to right: the reading order is the reverse.
    expect(pageParagraphs(items, VIEW)[0].text).toBe("الوحدة هي الخلية");
  });

  it("returns nothing for a page without text", () => {
    expect(pageParagraphs([], VIEW)).toEqual([]);
    expect(pageParagraphs([item("   ", 0, 0)], VIEW)).toEqual([]);
  });
});

describe("looksLikeMath", () => {
  it("recognizes formulas but not prose with a symbol", () => {
    expect(looksLikeMath("E = mc^2")).toBe(true);
    expect(looksLikeMath("∫ f(x) dx = F(b) − F(a)")).toBe(true);
    expect(looksLikeMath("The mean ± standard deviation was reported for every group in the study.")).toBe(false);
    expect(looksLikeMath("Introduction")).toBe(false);
  });
});

describe("lecture titles", () => {
  it("come from the PDF's own title when it is a real one, else from the file name", async () => {
    const { titleFromFileName, usableTitle } = await import("@/lib/study/import");
    expect(titleFromFileName("lecture_03-cell_biology.pdf")).toBe("lecture 03 cell biology");
    expect(titleFromFileName(".pdf")).toBe("Lecture");
    expect(usableTitle("  Enzymes and   Metabolism ")).toBe("Enzymes and Metabolism");
    expect(usableTitle("Microsoft Word - lecture3.docx")).toBeNull();
    expect(usableTitle("Untitled")).toBeNull();
    expect(usableTitle("slides.pptx")).toBeNull();
    expect(usableTitle(undefined)).toBeNull();
    expect(usableTitle("about:blank")).toBeNull();
    expect(usableTitle("https://example.edu/notes")).toBeNull();
  });
});

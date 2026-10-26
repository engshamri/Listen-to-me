import { describe, expect, it } from "vitest";
import { buildIndex, searchIndex, stem, tokens, type Passage } from "@/lib/study/search-index";

const p = (page: number, text: string): Passage => ({ docId: "d", page, index: 0, text, box: [0, 0, 1, 0.1] });

const lecture = [
  p(1, "Enzymes are biological catalysts that speed up chemical reactions in living cells without being consumed."),
  p(1, "The rate of an enzyme-catalysed reaction depends on temperature, pH, and the concentration of the substrate."),
  p(2, "Here Km is the substrate concentration at which the velocity is half of Vmax. A low Km means high affinity."),
  p(2, "Competitive inhibitors bind to the active site of the enzyme and block the substrate."),
  p(3, "الإنزيمات بروتينات تسرّع التفاعلات الكيميائية في الخلايا الحية دون أن تُستهلك."),
  p(3, "تتأثر سرعة التفاعل الإنزيمي بدرجة الحرارة ودرجة الحموضة وتركيز المادة المتفاعلة."),
];
const index = buildIndex(lecture);

describe("tokens and stems", () => {
  it("drops question words and stems plurals, Arabic articles and prepositions", () => {
    expect(tokens("What are competitive inhibitors?")).toEqual(["competitive", "inhibitor"]);
    expect(stem("catalysts")).toBe("catalyst");
    expect(stem("enzymes")).toBe("enzyme");
    expect(stem("properties")).toBe("property");
    expect(stem("bus")).toBe("bus");
    expect(tokens("ما هي الإنزيمات؟")).toEqual(["انزيم"]);
    expect(stem("بالحرارة")).toBe("حرار");
  });
});

describe("searchIndex", () => {
  it("ranks the passage that answers the question first, with its page", () => {
    const hits = searchIndex(index, "What is Km?");
    expect(hits[0].passage.page).toBe(2);
    expect(hits[0].passage.text).toContain("Km is the substrate concentration");
    expect(searchIndex(index, "How do competitive inhibitors work?")[0].passage.text).toContain("Competitive inhibitors bind");
  });

  it("finds Arabic passages for Arabic questions, ignoring hamza and endings", () => {
    const hits = searchIndex(index, "ما الذي يؤثر في سرعة التفاعل الانزيمي؟");
    expect(hits[0].passage.text).toContain("تتأثر سرعة التفاعل الإنزيمي");
  });

  it("reports nothing when most of the question's words are not in the lecture", () => {
    expect(searchIndex(index, "What is the capital of France?")).toEqual([]);
    expect(searchIndex(index, "Explain photosynthesis in chloroplasts")).toEqual([]);
    expect(searchIndex(index, "what is it?")).toEqual([]);
  });
});

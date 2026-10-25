import { describe, expect, it } from "vitest";
import { prepareForSpeech, splitIntoChunks } from "@/lib/text/chunk";
import { applyCleanup } from "@/lib/text/cleanup";
import { joinPreservingLines, splitPreservingLines } from "@/lib/text/lines";
import { matchesQuery, normalizeForSearch } from "@/lib/text/search";
import { countWords, detectScript, estimateDurationSeconds, scriptMismatch } from "@/lib/text/stats";

const strip = (s: string) => s.replace(/\s+/g, "");

describe("splitIntoChunks", () => {
  it("returns short text as a single chunk", () => {
    expect(splitIntoChunks("Hello world.")).toEqual(["Hello world."]);
    expect(splitIntoChunks("   \n ")).toEqual([]);
  });

  it("keeps every character, in order, and respects the size limit", () => {
    const para = "هذه جملة عربية طويلة نسبياً تحتوي على كلمات كثيرة. وهذه جملة أخرى؟ نعم! ";
    const text = Array.from({ length: 60 }, (_, i) => `${para}${i}\n\n`).join("");
    const chunks = splitIntoChunks(text, { maxLen: 500, locale: "ar" });
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(500);
    expect(strip(chunks.join(""))).toBe(strip(text));
  });

  it("never cuts a word in half, even inside one very long sentence", () => {
    const words = Array.from({ length: 900 }, (_, i) => `word${i}`);
    const text = words.join(" "); // no sentence punctuation at all
    const chunks = splitIntoChunks(text, { maxLen: 300 });
    const rejoined = chunks.join(" ").split(/\s+/);
    expect(rejoined).toEqual(words);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(300);
  });

  it("prefers paragraph boundaries", () => {
    const p1 = "First paragraph sentence. ".repeat(12).trim();
    const p2 = "Second paragraph sentence. ".repeat(12).trim();
    const chunks = splitIntoChunks(`${p1}\n\n${p2}`, { maxLen: 400 });
    expect(chunks[0].endsWith("sentence.")).toBe(true);
    expect(chunks.some((c) => c.startsWith("Second"))).toBe(true);
  });

  it("splits text without spaces (CJK) safely", () => {
    const text = "这是一个测试句子没有空格".repeat(100);
    const chunks = splitIntoChunks(text, { maxLen: 200, locale: "zh" });
    expect(chunks.join("")).toBe(text);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(200);
  });
});

describe("prepareForSpeech", () => {
  it("adds a full stop to lines without ending punctuation", () => {
    expect(prepareForSpeech("Chapter one\nIt begins.")).toBe("Chapter one.\nIt begins.");
    expect(prepareForSpeech("مقدمة\nبداية القصة.", { lang: "ar" })).toBe("مقدمة.\nبداية القصة.");
    expect(prepareForSpeech("第一章\n开始", { lang: "zh" })).toBe("第一章。\n开始。");
  });
  it("can be disabled", () => {
    expect(prepareForSpeech("Title\nBody", { pauseAtLineBreaks: false })).toBe("Title\nBody");
  });
  it("leaves lines that already end in punctuation", () => {
    expect(prepareForSpeech("Is it?\nYes!\nItems:")).toBe("Is it?\nYes!\nItems:");
  });
});

describe("Arabic-aware search", () => {
  it("normalizes hamza, taa marbuta, alef maqsura and tashkeel", () => {
    expect(normalizeForSearch("أماني")).toBe(normalizeForSearch("اماني"));
    expect(normalizeForSearch("ليلى")).toBe(normalizeForSearch("ليلي"));
    expect(normalizeForSearch("فاطمة")).toBe(normalizeForSearch("فاطمه"));
    expect(normalizeForSearch("مُحَمَّد")).toBe("محمد");
    expect(normalizeForSearch("Émilie")).toBe("emilie");
    expect(normalizeForSearch("٢٠٢٦")).toBe("2026");
  });
  it("matches all tokens in any order", () => {
    const hay = normalizeForSearch("Rana رنا Arabic العربية Iraq العراق female");
    expect(matchesQuery(hay, "female iraq")).toBe(true);
    expect(matchesQuery(hay, "العراق")).toBe(true);
    expect(matchesQuery(hay, "egypt")).toBe(false);
  });
});

describe("stats", () => {
  it("counts words in spaced and unspaced scripts", () => {
    expect(countWords("hello big world")).toBe(3);
    expect(countWords("مرحبا بكم جميعا")).toBe(3);
    expect(countWords("")).toBe(0);
    expect(countWords("我喜欢学习中文")).toBeGreaterThan(1);
  });
  it("detects scripts", () => {
    expect(detectScript("مرحبا بالعالم")).toBe("Arabic");
    expect(detectScript("Hello world")).toBe("Latin");
    expect(detectScript("Привет мир")).toBe("Cyrillic");
    expect(detectScript("こんにちは世界")).toBe("Kana");
    expect(detectScript("123 !!")).toBeNull();
  });
  it("flags script mismatches but never for multilingual voices", () => {
    expect(scriptMismatch("Arabic", "en", false)).toBe(true);
    expect(scriptMismatch("Arabic", "en", true)).toBe(false);
    expect(scriptMismatch("Arabic", "ar", false)).toBe(false);
    expect(scriptMismatch("Latin", "xx", false)).toBe(false);
  });
  it("estimates duration and scales with speed", () => {
    const text = "word ".repeat(150);
    const normal = estimateDurationSeconds(text, 1);
    expect(normal).toBeGreaterThan(45);
    expect(normal).toBeLessThan(75);
    expect(estimateDurationSeconds(text, 2)).toBeLessThan(normal);
  });
});

describe("cleanup", () => {
  it("tidies whitespace", () => {
    expect(applyCleanup("a   b\t c\n\n\n\nd ", "whitespace")).toBe("a b c\n\nd");
  });
  it("joins broken lines but keeps paragraphs", () => {
    expect(applyCleanup("This line was\nbroken by a PDF.\n\nNew para-\ngraph here.", "joinLines")).toBe("This line was broken by a PDF.\n\nNew paragraph here.");
  });
  it("removes links and emoji", () => {
    expect(applyCleanup("see https://example.com/x now", "links")).toBe("see now");
    expect(applyCleanup("hi 👋🏽 there 🇮🇶", "emoji").trim()).toBe("hi there");
  });
});

describe("line-preserving split", () => {
  it("round-trips and respects the size limit", () => {
    const text = Array.from({ length: 50 }, (_, i) => `Paragraph ${i} text.`).join("\n\n");
    const { pieces, separators } = splitPreservingLines(text, 120);
    expect(joinPreservingLines(pieces, separators)).toBe(text);
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(120);
  });
});

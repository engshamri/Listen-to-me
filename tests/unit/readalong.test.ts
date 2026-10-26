import { describe, expect, it } from "vitest";
import { subtitleCues, toSrt, toVtt } from "@/lib/audio/subtitles";
import { alignWords, estimateWords, locate, locateChunks, type SpeechWord } from "@/lib/text/align";
import { prepareForSpeech, splitIntoChunks } from "@/lib/text/chunk";
import { buildTimeline } from "@/lib/tts/timeline";

/** n MPEG-2 Layer III frames (24 kHz, 48 kbps, mono): 24 ms each. */
function mp3(n: number): ArrayBuffer {
  const frame = [0xff, 0xf3, 0x64, 0xc4, ...new Array(140).fill(0)];
  return new Uint8Array(Array.from({ length: n }, () => frame).flat()).buffer;
}

const w = (text: string, start: number, end = start + 0.2): SpeechWord => ({ text, start, end });
const slice = (text: string, s: { from: number; to: number }) => text.slice(s.from, s.to);

describe("aligning spoken words with the displayed text", () => {
  it("finds every chunk of the editor text in order", () => {
    const text = "First paragraph here. It has two sentences.\n\nSecond paragraph, also long enough to split.";
    const chunks = splitIntoChunks(text, { maxLen: 50 });
    const starts = locateChunks(text, chunks);
    chunks.forEach((c, i) => expect(text.slice(starts[i], starts[i] + c.length)).toBe(c));
  });

  it("places words as written, including numbers, symbols and Arabic with diacritics", () => {
    const en = "Tom & Jerry said: 3.5% of 2026 items cost $10.";
    const spans = alignWords(en, [w("Tom", 0.1), w("&", 0.46), w("Jerry", 0.57), w("said", 0.89), w("3.5%", 1.55), w("of", 2.8), w("2026", 2.9), w("items", 3.79), w("cost", 4.29), w("$10", 4.67)]);
    expect(spans.map((s) => slice(en, s))).toEqual(["Tom", "&", "Jerry", "said", "3.5%", "of", "2026", "items", "cost", "$10"]);

    const ar = "مرحباً بكم في اسمعني. هذا اختبار للكلمات، وعلامات الترقيم؟";
    const arSpans = alignWords(ar, ["مرحباً", "بكم", "في", "اسمعني", "هذا", "اختبار", "للكلمات", "وعلامات", "الترقيم"].map((t, i) => w(t, i * 0.5)));
    expect(arSpans.map((s) => slice(ar, s))).toEqual(["مرحباً", "بكم", "في", "اسمعني", "هذا", "اختبار", "للكلمات", "وعلامات", "الترقيم"]);
  });

  it("skips words it can't find nearby instead of jumping ahead", () => {
    const text = `Alpha beta ${"filler ".repeat(40)}gamma.`;
    const spans = alignWords(text, [w("Alpha", 0), w("unknown", 0.3), w("beta", 0.5), w("gamma", 0.7)]);
    expect(spans.map((s) => slice(text, s))).toEqual(["Alpha", "beta"]); // "gamma" is beyond the search window
  });

  it("ignores the full stops added for pauses after headings", () => {
    const display = "Chapter one\nThe story begins";
    const spoken = prepareForSpeech(display, { lang: "en" });
    expect(spoken).toBe("Chapter one.\nThe story begins.");
    const spans = alignWords(display, [w("Chapter", 0), w("one", 0.4), w("The", 1), w("story", 1.2), w("begins", 1.5)]);
    expect(spans).toHaveLength(5);
  });

  it("estimates word times from their length when the voice sent none", () => {
    const spans = estimateWords("aa bbbb aa", 4, 10);
    expect(spans.map((s) => [s.from, s.to])).toEqual([[10, 12], [13, 17], [18, 20]]);
    expect(spans.map((s) => s.start)).toEqual([0, 1, 3]);
    expect(spans[2].end).toBeCloseTo(4);
  });

  it("locate() returns the last span that has started", () => {
    const spans = [0.5, 1, 2].map((start) => ({ from: 0, to: 1, start, end: start + 0.4 }));
    expect([0, 0.5, 0.9, 1, 5].map((t) => locate(spans, t))).toEqual([-1, 0, 0, 1, 2]);
  });
});

describe("timeline for the joined audio", () => {
  const text = "One two three. Four five.\n\nSix seven eight.";
  const displayChunks = ["One two three. Four five.", "Six seven eight."];
  const chunk1 = [w("One", 0.1), w("two", 0.3), w("three", 0.5), w("Four", 0.8), w("five", 1.0)];
  const chunk2 = [w("Six", 0.05), w("seven", 0.25), w("eight", 0.45)];

  it("shifts each chunk by the length of the audio before it", () => {
    const t = buildTimeline({ text, displayChunks, audio: [mp3(50), mp3(25)], words: [chunk1, chunk2], locale: "en" });
    expect(t.approximate).toBe(false);
    expect(t.text).toBe(text);
    expect(t.words.map((s) => slice(text, s))).toEqual(["One", "two", "three", "Four", "five", "Six", "seven", "eight"]);
    const six = t.words[5];
    expect(six.start).toBeCloseTo(1.2 + 0.05, 5); // 50 frames × 24 ms before it
    expect(t.sentences.map((s) => slice(text, s))).toEqual(["One two three.", "Four five.", "Six seven eight."]);
    // A sentence lasts until the next starts, so the box stays during pauses.
    expect(t.sentences[0].end).toBeCloseTo(t.sentences[1].start, 5);
    expect(t.sentences[1].end).toBeCloseTo(t.sentences[2].start, 5);
  });

  it("covers only the finished leading parts of a partial result", () => {
    const t = buildTimeline({ text, displayChunks, audio: [mp3(50)], words: [chunk1], locale: "en" });
    expect(t.text).toBe("One two three. Four five.");
    expect(t.sentences).toHaveLength(2);
  });

  it("estimates parts read by the backup voice and says so", () => {
    const t = buildTimeline({ text, displayChunks, audio: [mp3(50), mp3(25)], words: [chunk1, null], locale: "en" });
    expect(t.approximate).toBe(true);
    const lastThree = t.words.slice(-3);
    expect(lastThree.map((s) => slice(text, s))).toEqual(["Six", "seven", "eight."]);
    expect(lastThree[0].start).toBeCloseTo(1.2, 5);
    expect(lastThree[2].end).toBeLessThanOrEqual(1.8 + 1e-9);
  });

  it("works for Arabic text", () => {
    const ar = "مرحباً بكم. هذا اختبار.";
    const t = buildTimeline({ text: ar, displayChunks: [ar], audio: [mp3(100)], words: [[w("مرحباً", 0.1), w("بكم", 0.7), w("هذا", 1.3), w("اختبار", 1.6)]], locale: "ar" });
    expect(t.sentences.map((s) => slice(ar, s))).toEqual(["مرحباً بكم.", "هذا اختبار."]);
    expect(locate(t.words, 1.4)).toBe(2);
  });
});

describe("subtitles from the timeline", () => {
  it("one cue per sentence in SRT and WebVTT format", () => {
    const text = "One two three. Four five.";
    const t = buildTimeline({ text, displayChunks: [text], audio: [mp3(100)], words: [[w("One", 0.1), w("two", 0.3), w("three", 0.5), w("Four", 1.25), w("five", 1.5, 1.9)]], locale: "en" });
    const cues = subtitleCues(t);
    expect(cues.map((c) => c.text)).toEqual(["One two three.", "Four five."]);
    const srt = toSrt(cues);
    expect(srt).toBe("1\n00:00:00,100 --> 00:00:01,250\nOne two three.\n\n2\n00:00:01,250 --> 00:00:01,900\nFour five.\n");
    expect(toVtt(cues).startsWith("WEBVTT\n\n00:00:00.100 --> 00:00:01.250\nOne two three.\n")).toBe(true);
  });

  it("splits long sentences at word boundaries into cues of at most two lines", () => {
    const words = Array.from({ length: 30 }, (_, i) => `word${i}`);
    const text = `${words.join(" ")}.`;
    const t = buildTimeline({ text, displayChunks: [text], audio: [mp3(500)], words: [words.map((x, i) => w(x, i * 0.3))], locale: "en" });
    const cues = subtitleCues(t);
    expect(cues.length).toBeGreaterThan(1);
    for (const c of cues) {
      const lines = c.text.split("\n");
      expect(lines.length).toBeLessThanOrEqual(2);
      expect(c.text.replace("\n", " ").length).toBeLessThanOrEqual(84);
      expect(c.end).toBeGreaterThan(c.start);
    }
    expect(cues.map((c) => c.text.replace("\n", " ")).join(" ")).toBe(text);
  });
});

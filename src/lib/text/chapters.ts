import type { Span } from "./align";

/*
 * Chapters in course notes and long documents, found from their headings:
 *  - Markdown headings ("# Cells", "## 2.1 Membranes");
 *  - "Chapter / Lesson / Lecture / Unit / Part / Section / Module / Week / Topic N"
 *    and "الفصل / الدرس / المحاضرة / الوحدة / الباب / الجزء / القسم / المبحث / الموضوع / الأسبوع";
 *  - numbered headings on their own line ("3. Photosynthesis", "2.1 Light");
 *  - when none of those exist: short lines standing alone between blank lines,
 *    without the punctuation that ends a sentence.
 */

export interface Chapter {
  /** Empty for text that comes before the first heading. */
  title: string;
  /** Character range in the text: from the heading to the next chapter. */
  from: number;
  to: number;
}

const MARKDOWN = /^#{1,4}\s+(\S.*)$/u;
const KEYWORD_LATIN = /^(?:chapter|lesson|lecture|unit|part|section|module|week|topic)\s+(?:\d+|[ivxlc]+|one|two|three|four|five|six|seven|eight|nine|ten)\b/iu;
const KEYWORD_ARABIC = /^(?:الفصل|الدرس|المحاضرة|الوحدة|الباب|الجزء|القسم|المبحث|الموضوع|الأسبوع)(?:\s|:|$)/u;
const NUMBERED = /^\d{1,2}(?:\.\d{1,2}){0,2}[.)]?\s+\p{L}/u;
const SENTENCE_END = /[.!?؟…,;،؛]$/u;
const MAX_HEADING = 100;
const MAX_CHAPTERS = 200;
/** Text before the first heading shorter than this is treated as the document's title, not a chapter. */
const MIN_INTRO = 80;

interface Line {
  text: string;
  from: number;
}

function headingTitle(line: string): string {
  const md = MARKDOWN.exec(line);
  return (md ? md[1] : line).replace(/\s+/g, " ").trim().slice(0, MAX_HEADING);
}

export function detectChapters(text: string): Chapter[] {
  const lines: Line[] = [];
  let at = 0;
  for (const raw of text.split("\n")) {
    const lead = raw.length - raw.trimStart().length;
    lines.push({ text: raw.trim(), from: at + lead });
    at += raw.length + 1;
  }
  const blank = (i: number) => i < 0 || i >= lines.length || !lines[i].text;
  const strong: number[] = [];
  const weak: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].text;
    if (!line || line.length > MAX_HEADING) continue;
    const startsBlock = blank(i - 1) || strong.at(-1) === i - 1;
    const sentence = SENTENCE_END.test(line);
    if (MARKDOWN.test(line)) strong.push(i);
    else if ((KEYWORD_LATIN.test(line) || KEYWORD_ARABIC.test(line)) && startsBlock && (!sentence || line.length <= 40)) strong.push(i);
    else if (NUMBERED.test(line) && !sentence && line.length <= 80 && blank(i - 1) && blank(i + 1)) strong.push(i);
    else if (!sentence && line.length <= 60 && /^\p{L}/u.test(line) && blank(i - 1) && blank(i + 1) && i < lines.length - 1) weak.push(i);
  }
  const headings = strong.length >= 2 ? strong : weak.length >= 2 ? weak : [];
  if (!headings.length) return [];

  // Headings with nothing but blank lines between them form one chapter ("# Part 1" + "## Chapter 1").
  const groups: number[][] = [];
  for (const h of headings) {
    const last = groups.at(-1);
    const prev = last?.at(-1);
    if (last && prev !== undefined && lines.slice(prev + 1, h).every((l) => !l.text)) last.push(h);
    else groups.push([h]);
  }

  const chapters: Chapter[] = groups.map((g) => ({ title: g.map((i) => headingTitle(lines[i].text)).join(" · "), from: lines[g[0]].from, to: 0 }));
  const intro = text.slice(0, chapters[0].from).trim();
  if (intro.length >= MIN_INTRO) chapters.unshift({ title: "", from: 0, to: 0 });
  else chapters[0].from = 0;
  chapters.forEach((c, i) => {
    c.to = chapters[i + 1]?.from ?? text.length;
  });
  return chapters.length >= 2 ? chapters.slice(0, MAX_CHAPTERS) : [];
}

/** The text of the chosen chapters, in document order, separated by a blank line. */
export function chaptersText(text: string, chapters: Chapter[], chosen: number[]): string {
  return [...new Set(chosen)]
    .sort((a, b) => a - b)
    .map((i) => chapters[i] && text.slice(chapters[i].from, chapters[i].to).trim())
    .filter(Boolean)
    .join("\n\n");
}

/** When each chapter starts in the audio: its first sentence's start, or null if that part was not generated. */
export function chapterStarts(chapters: Chapter[], sentences: Span[]): (number | null)[] {
  let s = 0;
  return chapters.map((c) => {
    while (s < sentences.length && sentences[s].from < c.from) s++;
    const first = sentences[s];
    return first && first.from < c.to ? first.start : null;
  });
}

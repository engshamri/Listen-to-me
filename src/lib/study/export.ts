/* Markdown exports with page references: translations, notes and quizzes. */
import { UNTRANSLATED_KINDS } from "./layout";
import type { Question } from "./quiz";
import type { Annotation, StudyPage } from "./store";

export interface ExportLabels {
  page: (n: number) => string;
  ocr: (percent: number) => string;
  notTranslated: string;
  bookmark: string;
}

const quote = (text: string) =>
  text
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");

/**
 * The translated pages of a lecture: for each page, every paragraph as a
 * quote of the original followed by its translation. Code and formulas are
 * kept as code blocks. Pages without a translation are left out.
 */
export function translationMarkdown(title: string, pages: StudyPage[], lang: string, labels: ExportLabels): string {
  const parts = [`# ${title}`];
  for (const page of pages) {
    const tr = page.translations?.[lang];
    if (!tr) continue;
    const head = page.source === "ocr" && page.confidence !== undefined ? `## ${labels.page(page.page)} (${labels.ocr(Math.round(page.confidence))})` : `## ${labels.page(page.page)}`;
    const body = page.paragraphs.map((p, i) => {
      if (UNTRANSLATED_KINDS.has(p.kind)) return `\`\`\`\n${p.text}\n\`\`\`\n\n*${labels.notTranslated}*`;
      return `${quote(p.text)}\n\n${tr.paragraphs[i] ?? ""}`.trim();
    });
    parts.push([head, ...body].join("\n\n"));
  }
  return `${parts.join("\n\n")}\n`;
}

/** Highlights, notes and bookmarks in page order. */
export function notesMarkdown(title: string, annotations: Annotation[], labels: ExportLabels): string {
  const parts = [`# ${title}`];
  const byPage = new Map<number, Annotation[]>();
  for (const a of annotations) byPage.set(a.page, [...(byPage.get(a.page) ?? []), a]);
  for (const [page, list] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
    const items = list.map((a) => {
      const lines: string[] = [];
      if (a.kind === "bookmark") lines.push(`- **${labels.bookmark}**${a.note.trim() ? `: ${a.note.trim()}` : ""}`);
      else {
        lines.push(`- ${quote(a.quote).replace(/\n/g, "\n  ")}`);
        if (a.note.trim()) lines.push(`  ${a.note.trim().replace(/\n/g, "\n  ")}`);
      }
      return lines.join("\n");
    });
    parts.push([`## ${labels.page(page)}`, ...items].join("\n\n"));
  }
  return `${parts.join("\n\n")}\n`;
}

export interface QuizLabels {
  page: (n: number) => string;
  prompt: (q: Question) => string;
  yes: string;
  no: string;
  answerKey: string;
}

const LETTERS = "ABCDEFGHIJ";

/** A printable quiz: the questions, then the answer key with each answer's page. */
export function quizMarkdown(title: string, questions: Question[], labels: QuizLabels): string {
  const body = questions.map((q, i) => {
    const lines = [`**${i + 1}. ${labels.prompt(q)}**`];
    if (q.kind === "mcq-term") lines.push("", `> ${q.definition}`, "", ...q.options.map((o, k) => `- ${LETTERS[k]}) ${o}`));
    else if (q.kind === "mcq-definition") lines.push("", ...q.options.map((o, k) => `- ${LETTERS[k]}) ${o}`));
    else if (q.kind === "true-false") lines.push("", `> ${q.term}: ${q.definition}`, "", `- ${labels.yes}`, `- ${labels.no}`);
    else if (q.kind === "fill-blank") lines.push("", `> ${q.prompt}`);
    else lines.push("", ...q.terms.map((term, k) => `- ${k + 1}. ${term}`), "", ...q.definitions.map((d, k) => `- ${LETTERS[k]}) ${d}`));
    return lines.join("\n");
  });
  const key = questions.map((q, i) => {
    let answer: string;
    if (q.kind === "mcq-term" || q.kind === "mcq-definition") answer = `${LETTERS[q.options.indexOf(q.answer)]}) ${q.answer}`;
    else if (q.kind === "true-false") answer = q.answer ? labels.yes : `${labels.no} (${q.term}: ${q.correctDefinition})`;
    else if (q.kind === "fill-blank") answer = q.answer;
    else answer = q.terms.map((term, k) => `${k + 1}–${LETTERS[q.definitions.indexOf(q.answer[term])]}`).join(", ");
    return `${i + 1}. ${answer} (${labels.page(q.page)})`;
  });
  return `# ${title}\n\n${body.join("\n\n")}\n\n## ${labels.answerKey}\n\n${key.join("\n")}\n`;
}

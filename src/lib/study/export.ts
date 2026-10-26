/* Markdown exports with page references: translations and notes. */
import { UNTRANSLATED_KINDS } from "./layout";
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

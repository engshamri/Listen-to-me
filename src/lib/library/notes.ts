import type { Bookmark } from "./store";

/**
 * Bookmarks and notes as Markdown, one section per bookmark in time order:
 *
 *   # Lesson 3: Photosynthesis
 *
 *   Ava · Oct 26, 2026 · 2:43
 *
 *   ## Bookmarks
 *
 *   ### 0:12
 *
 *   > Plants turn light into chemical energy.
 *
 *   Remember: chlorophyll is green.
 */
export function bookmarksMarkdown({
  title,
  details,
  heading,
  bookmarks,
  clock,
}: {
  title: string;
  /** One line under the title, e.g. voice, date and length. */
  details: string;
  /** The "Bookmarks" heading, in the interface language. */
  heading: string;
  bookmarks: Bookmark[];
  clock: (seconds: number) => string;
}): string {
  const quote = (text: string) =>
    text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => `> ${l}`)
      .join("\n");
  const sections = bookmarks
    .slice()
    .sort((a, b) => a.time - b.time)
    .map((b) => [`### ${clock(b.time)}`, quote(b.excerpt), b.note.trim()].filter(Boolean).join("\n\n"));
  return [`# ${title.replace(/\s+/g, " ").trim()}`, details, `## ${heading}`, ...sections].join("\n\n") + "\n";
}

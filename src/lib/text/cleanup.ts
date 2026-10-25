/** Optional, user-triggered text clean-up actions. Each returns new text. */

export type CleanupAction = "whitespace" | "joinLines" | "links" | "emoji";

export function collapseWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Re-joins lines that were broken mid-sentence (typical of text copied from
 * PDFs). Paragraph breaks (blank lines) and lines ending in punctuation are kept.
 */
export function joinBrokenLines(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((para) =>
      para
        // Latin hyphenation at line end: "exam-\nple" -> "example"
        .replace(/(\p{Ll})-\n(\p{Ll})/gu, "$1$2")
        .replace(/([^\n.!?؟。！？:;؛…])\n(?=\S)/gu, "$1 "),
    )
    .join("\n\n");
}

export function removeLinks(text: string): string {
  return text
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>"']+/giu, "")
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gu, "")
    .replace(/[ \t]{2,}/g, " ");
}

export function removeEmoji(text: string): string {
  return text
    .replace(/(?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\p{Emoji_Modifier}|️|‍\p{Extended_Pictographic})*|[\p{Emoji_Modifier}️‍]/gu, "")
    .replace(/[ \t]{2,}/g, " ");
}

export function applyCleanup(text: string, action: CleanupAction): string {
  switch (action) {
    case "whitespace":
      return collapseWhitespace(text);
    case "joinLines":
      return joinBrokenLines(text);
    case "links":
      return removeLinks(text);
    case "emoji":
      return removeEmoji(text);
  }
}

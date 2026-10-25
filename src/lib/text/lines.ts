/**
 * Splits text into pieces made of whole lines, returning the pieces and the
 * exact separators between them, so paragraph structure survives processing
 * each piece independently (e.g. translation).
 */
export function splitPreservingLines(text: string, max: number): { pieces: string[]; separators: string[] } {
  const tokens = text.replace(/\r\n?/g, "\n").split(/(\n+)/);
  const pieces: string[] = [];
  const separators: string[] = [];
  let cur = "";
  let pendingSep = "";
  const push = (sep: string) => {
    pieces.push(cur);
    separators.push(sep);
    cur = "";
  };
  for (const tok of tokens) {
    if (/^\n+$/.test(tok)) {
      pendingSep = tok;
      continue;
    }
    if (!tok) continue;
    if (cur && cur.length + pendingSep.length + tok.length > max) push(pendingSep);
    else if (cur) cur += pendingSep;
    pendingSep = "";
    if (tok.length <= max) {
      cur += tok;
      continue;
    }
    // One enormous line: break at a sentence end or space near the limit.
    let rest = tok;
    while (rest.length > max) {
      let cut = rest.lastIndexOf(". ", max);
      if (cut < max * 0.5) cut = rest.lastIndexOf(" ", max);
      if (cut < max * 0.5) cut = max - 1;
      cur += rest.slice(0, cut + 1);
      push(" ");
      rest = rest.slice(cut + 1).trimStart();
    }
    cur += rest;
  }
  if (cur) {
    pieces.push(cur);
    separators.push("");
  }
  return { pieces, separators };
}

/** Inverse of splitPreservingLines. */
export function joinPreservingLines(pieces: string[], separators: string[]): string {
  return pieces.map((p, i) => p + (separators[i] ?? "")).join("");
}

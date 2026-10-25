/**
 * Backup voice: Google Translate's free speech endpoint. It speaks with one
 * generic voice per language, limited to ~200 characters per request, and
 * ignores speed and pitch. Only used when the user explicitly opts in.
 */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const MAX_PIECE = 180;

/** Splits at whitespace so words are never cut; very long tokens are split by code point. */
export function splitForBackup(text: string): string[] {
  const pieces: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/u).filter(Boolean)) {
    if (word.length > MAX_PIECE) {
      if (cur) pieces.push(cur);
      cur = "";
      const cps = Array.from(word);
      for (let i = 0; i < cps.length; i += MAX_PIECE) pieces.push(cps.slice(i, i + MAX_PIECE).join(""));
      continue;
    }
    if (cur && cur.length + 1 + word.length > MAX_PIECE) {
      pieces.push(cur);
      cur = word;
    } else {
      cur = cur ? `${cur} ${word}` : word;
    }
  }
  if (cur) pieces.push(cur);
  return pieces;
}

export async function synthesizeBackup(text: string, lang: string, signal?: AbortSignal): Promise<Buffer> {
  const buffers: Buffer[] = [];
  for (const piece of splitForBackup(text)) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(piece)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Referer: "https://translate.google.com/" },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`backup voice HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 200) throw new Error("backup voice returned no audio");
    buffers.push(buf);
    await new Promise((r) => setTimeout(r, 120));
  }
  return Buffer.concat(buffers);
}

/**
 * Download file names: product, voice, locale and a second-resolution
 * timestamp, e.g. "listen-to-me_rana_ar-IQ_2026-10-25_14-30-12.mp3".
 * ASCII only, so names survive every OS and messaging app.
 */
export function downloadName(voiceName: string, locale: string, createdAt: Date, ext: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = createdAt;
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  const slug = voiceName
    .normalize("NFKD")
    .replace(/[^\w-]+/g, "")
    .toLowerCase() || "voice";
  return `listen-to-me_${slug}_${locale}_${stamp}.${ext}`;
}

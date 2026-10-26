/**
 * Many PDF fonts map the dotted (initial and medial) form of Arabic yeh and kaf
 * to the Persian letters ی and ک, which breaks search, speech and copying. In
 * text without Persian-only letters (پ چ ژ گ), use the Arabic letters.
 */
export function arabicLetters(text: string): string {
  // The same happens with heh: the Urdu ھ for the Arabic ه (unless the text is Urdu).
  if (/[پچژگٹڈڑںےۓ]/u.test(text) || !/[یکھ]/u.test(text)) return text;
  return text.replace(/ی/gu, "ي").replace(/ک/gu, "ك").replace(/ھ/gu, "ه");
}

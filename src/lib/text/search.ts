/**
 * Search normalization. Makes queries forgiving of the spelling variations
 * people actually type:
 *  - Arabic: hamza forms of alef (أ إ آ ٱ), taa marbuta (ة/ه), alef maqsura
 *    (ى/ي), hamza on waw/yaa, Persian kaf/yeh, tashkeel and tatweel.
 *  - Latin and other scripts: case and diacritics (é -> e).
 *  - Eastern Arabic and Persian digits -> ASCII digits.
 */
export function normalizeForSearch(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[ً-ٰٟۖ-ۭـ]/g, "") // tashkeel, superscript alef, Quranic marks, tatweel
    .replace(/\p{Mn}/gu, "") // remaining combining marks (Latin diacritics etc.)
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[ىی]/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ک/g, "ك")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .toLocaleLowerCase("en")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when every query token appears in the (already normalized) haystack. */
export function matchesQuery(normalizedHaystack: string, query: string): boolean {
  const q = normalizeForSearch(query);
  if (!q) return true;
  return q.split(" ").every((token) => normalizedHaystack.includes(token));
}

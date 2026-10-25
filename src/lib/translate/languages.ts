/** Target languages offered for translation (codes accepted by the provider). */
export const TRANSLATION_LANGUAGES = [
  "af", "sq", "am", "ar", "hy", "az", "eu", "be", "bn", "bs", "bg", "ca", "ceb", "zh-CN", "zh-TW", "co", "hr",
  "cs", "da", "nl", "en", "eo", "et", "fil", "fi", "fr", "fy", "gl", "ka", "de", "el", "gu", "ht", "ha", "haw",
  "he", "hi", "hmn", "hu", "is", "ig", "id", "ga", "it", "ja", "jv", "kn", "kk", "km", "rw", "ko", "ku", "ckb",
  "ky", "lo", "la", "lv", "lt", "lb", "mk", "mg", "ms", "ml", "mt", "mi", "mr", "mn", "my", "ne", "nb", "ny",
  "or", "ps", "fa", "pl", "pt", "pa", "ro", "ru", "sm", "gd", "sr", "st", "sn", "sd", "si", "sk", "sl", "so",
  "es", "su", "sw", "sv", "tg", "ta", "tt", "te", "th", "tr", "tk", "uk", "ur", "ug", "uz", "vi", "cy", "xh",
  "yi", "yo", "zu",
] as const;

/** Language part used to match translation targets with voices ("zh-TW" -> "zh"). */
export function baseLanguage(code: string): string {
  return code.split("-")[0].toLowerCase();
}

const displayNameCache = new Map<string, Intl.DisplayNames>();

/** Localized language name, e.g. languageLabel("fr", "ar") -> "الفرنسية". */
export function languageLabel(code: string, uiLocale: string): string {
  let dn = displayNameCache.get(uiLocale);
  if (!dn) {
    dn = new Intl.DisplayNames([uiLocale], { type: "language", fallback: "code" });
    displayNameCache.set(uiLocale, dn);
  }
  try {
    const name = dn.of(code) ?? code;
    return uiLocale === "en" ? name.charAt(0).toUpperCase() + name.slice(1) : name;
  } catch {
    return code;
  }
}

/** Splits long text into translation requests at line boundaries. */
export const TRANSLATE_REQUEST_CHARS = 18_000;
export const TRANSLATE_MAX_CHARS = 100_000;

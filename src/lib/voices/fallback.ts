/**
 * The backup engine (Google Translate's free speech endpoint) has one generic
 * voice per language and ignores gender, speed and pitch. It is only ever used
 * after the user explicitly agrees, and only for languages it can speak.
 *
 * Maps a voice locale to the backup engine's language code, or null.
 */
const BACKUP_LANGS: Record<string, string> = {
  af: "af", ar: "ar", bg: "bg", bn: "bn", bs: "bs", ca: "ca", cs: "cs", cy: "cy", da: "da", de: "de",
  el: "el", en: "en", es: "es", et: "et", fi: "fi", fil: "tl", fr: "fr", gu: "gu", he: "iw", hi: "hi",
  hr: "hr", hu: "hu", id: "id", is: "is", it: "it", ja: "ja", jv: "jw", km: "km", kn: "kn", ko: "ko",
  lv: "lv", ml: "ml", mr: "mr", ms: "ms", my: "my", nb: "no", ne: "ne", nl: "nl", pl: "pl", pt: "pt",
  ro: "ro", ru: "ru", si: "si", sk: "sk", sq: "sq", sr: "sr", su: "su", sv: "sv", sw: "sw", ta: "ta",
  te: "te", th: "th", tr: "tr", uk: "uk", ur: "ur", vi: "vi",
};

export function backupLanguageFor(locale: string): string | null {
  if (locale === "zh-CN") return "zh-CN";
  if (locale === "zh-TW") return "zh-TW";
  if (locale.startsWith("zh-")) return null; // Cantonese and Mandarin dialect voices have no faithful backup
  return BACKUP_LANGS[locale.split("-")[0]] ?? null;
}

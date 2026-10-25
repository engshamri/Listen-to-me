import data from "@/data/voice-quality.json";

/**
 * Results of the voice audit (scripts/voice-qa/run_audit.py). See
 * docs/VOICE-QUALITY.md for the method. "verified" means the voice passed the
 * automated audio and speech-recognition checks; it is not a claim about how
 * human it sounds.
 */
export type QualityStatus = "verified" | "audio_only" | "review" | "disabled";

export interface VoiceQuality {
  status: QualityStatus;
  flags: string[];
  /** Character error rate of speech recognition on the test paragraph (0 = perfect). */
  cer: number | null;
}

interface QualityFile {
  generatedAt: string | null;
  voices: Record<string, Partial<VoiceQuality>>;
  multilingual: Record<string, string[]>;
}

const file = data as unknown as QualityFile;

export function qualityOf(id: string): VoiceQuality | null {
  const q = file.voices?.[id];
  if (!q?.status) return null;
  return { status: q.status, flags: q.flags ?? [], cer: typeof q.cer === "number" ? q.cer : null };
}

/** Percentage of the test paragraph the recognizer understood, for verified voices. */
export function clarityPercent(id: string): number | null {
  const q = qualityOf(id);
  if (q?.status !== "verified" || q.cer === null) return null;
  return Math.max(0, Math.round((1 - q.cer) * 100));
}

/** Multilingual voices whose reading of `lang` passed the speech-recognition test. */
export function multilingualVerifiedFor(lang: string): string[] {
  return Object.entries(file.multilingual ?? {})
    .filter(([, langs]) => langs.includes(lang))
    .map(([id]) => id);
}

export const QUALITY_AUDIT_DATE = file.generatedAt;

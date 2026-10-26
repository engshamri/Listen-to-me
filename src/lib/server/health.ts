import { LIMITS, serverConfig } from "./config";
import { hasFfmpeg } from "./ffmpeg";
import { providerName } from "./translate";

export interface Health {
  converter: boolean;
  /** Largest MP3 /api/convert accepts (smaller on hosts that cap request bodies). */
  convertMaxBytes: number;
  translation: string;
  backupVoice: boolean;
}

let cache: { value: Health; at: number } | null = null;

/** What this installation can do. Cached for 30 seconds. */
export async function getHealth(): Promise<Health> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const value = {
    converter: await hasFfmpeg(),
    convertMaxBytes: LIMITS.convertBodyBytes,
    translation: providerName(),
    backupVoice: serverConfig.backupVoiceEnabled,
  };
  cache = { value, at: Date.now() };
  return value;
}

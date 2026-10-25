import { serverConfig } from "./config";
import { hasFfmpeg } from "./ffmpeg";
import { runProcess } from "./process";
import { providerName } from "./translate";

export interface Health {
  speechEngine: boolean;
  converter: boolean;
  translation: string;
  backupVoice: boolean;
}

let cache: { value: Health; at: number } | null = null;

async function hasEdgeTts(): Promise<boolean> {
  try {
    const r = await runProcess(serverConfig.pythonBin, ["-c", "import edge_tts"], { timeoutMs: 15_000 });
    return r.code === 0;
  } catch {
    return false;
  }
}

/** What this installation can do. Cached for 30 seconds. */
export async function getHealth(): Promise<Health> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const [speechEngine, converter] = await Promise.all([hasEdgeTts(), hasFfmpeg()]);
  const value = { speechEngine, converter, translation: providerName(), backupVoice: serverConfig.backupVoiceEnabled };
  cache = { value, at: Date.now() };
  return value;
}

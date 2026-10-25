import path from "node:path";

function int(name: string, fallback: number): number {
  const v = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Server configuration from environment variables (see .env.example). */
export const serverConfig = {
  pythonBin: process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3"),
  ffmpegBin: process.env.FFMPEG_BIN || "ffmpeg",
  synthScript: path.join(process.cwd(), "scripts", "edge_synth.py"),
  videoCover: path.join(process.cwd(), "public", "brand", "video-cover.png"),
  previewCacheDir: process.env.PREVIEW_CACHE_DIR || path.join(process.cwd(), ".cache", "previews"),

  edgeTimeoutSec: int("TTS_TIMEOUT_SECONDS", 90),
  ttsMaxConcurrency: int("TTS_MAX_CONCURRENCY", 6),
  convertMaxConcurrency: int("CONVERT_MAX_CONCURRENCY", 2),
  backupVoiceEnabled: process.env.ENABLE_BACKUP_VOICE !== "false",
  /** Believe X-Forwarded-For / X-Forwarded-Host (only behind a reverse proxy that sets them). */
  trustProxy: process.env.TRUST_PROXY === "true",

  translateProvider: (process.env.TRANSLATE_PROVIDER || "google") as "google" | "libretranslate",
  libreTranslateUrl: process.env.LIBRETRANSLATE_URL || "",
  libreTranslateKey: process.env.LIBRETRANSLATE_API_KEY || "",

  rateLimits: {
    tts: int("RATE_LIMIT_TTS_PER_MINUTE", 240),
    preview: int("RATE_LIMIT_PREVIEW_PER_MINUTE", 60),
    translate: int("RATE_LIMIT_TRANSLATE_PER_MINUTE", 30),
    convert: int("RATE_LIMIT_CONVERT_PER_MINUTE", 12),
  },
};

export const LIMITS = {
  ttsChunkChars: 5000,
  ttsBodyBytes: 64 * 1024,
  translateRequestChars: 20_000,
  translateBodyBytes: 256 * 1024,
  /** ~2.7 hours of 48 kbps MP3. */
  convertBodyBytes: 60 * 1024 * 1024,
  convertTimeoutMs: 10 * 60 * 1000,
};

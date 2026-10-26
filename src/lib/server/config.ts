import os from "node:os";
import path from "node:path";

function int(name: string, fallback: number): number {
  const v = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * On Vercel the file system is read-only (except the temp dir), request bodies
 * are capped at 4.5 MB, and the platform sets X-Forwarded-For itself.
 */
const onVercel = process.env.VERCEL === "1";

/** Server configuration from environment variables (see .env.example). */
export const serverConfig = {
  /** Empty: use ffmpeg from PATH, else the copy installed by the ffmpeg-static package. */
  ffmpegBin: process.env.FFMPEG_BIN || "",
  videoCover: path.join(process.cwd(), "public", "brand", "video-cover.png"),
  previewCacheDir:
    process.env.PREVIEW_CACHE_DIR || (onVercel ? path.join(os.tmpdir(), "listen-to-me-previews") : path.join(process.cwd(), ".cache", "previews")),

  /** Upper bound for one /api/tts request; stalls are caught sooner (45 s without data). */
  edgeTimeoutSec: int("TTS_TIMEOUT_SECONDS", 240),
  ttsMaxConcurrency: int("TTS_MAX_CONCURRENCY", 6),
  convertMaxConcurrency: int("CONVERT_MAX_CONCURRENCY", 2),
  backupVoiceEnabled: process.env.ENABLE_BACKUP_VOICE !== "false",
  /** Believe X-Forwarded-For / X-Forwarded-Host (only behind a proxy that sets them; on by default on Vercel). */
  trustProxy: process.env.TRUST_PROXY ? process.env.TRUST_PROXY === "true" : onVercel,

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
  /** ~2.7 hours of 48 kbps MP3 locally; ~11 minutes on Vercel, whose request bodies stop at 4.5 MB. */
  convertBodyBytes: int("CONVERT_MAX_BYTES", onVercel ? 4_000_000 : 60 * 1024 * 1024),
  /** Stays inside the convert route's maxDuration (300 s) on Vercel. */
  convertTimeoutMs: onVercel ? 280_000 : 10 * 60 * 1000,
};

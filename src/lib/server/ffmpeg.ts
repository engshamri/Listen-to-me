import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { LIMITS, serverConfig } from "./config";
import { ProcessError, runProcess, withTempDir } from "./process";
import { Semaphore } from "./semaphore";

export type ConvertFormat = "m4a" | "mp4";

export class ConvertError extends Error {
  constructor(public code: "NOT_INSTALLED" | "FAILED" | "ABORTED" | "TIMEOUT", message?: string) {
    super(message ?? code);
  }
}

const slots = new Semaphore(serverConfig.convertMaxConcurrency);

let resolved: { bin: string | null; at: number } | null = null;

async function runs(bin: string): Promise<boolean> {
  try {
    return (await runProcess(bin, ["-version"], { timeoutMs: 10_000 })).code === 0;
  } catch {
    return false;
  }
}

/** Path of the binary installed by the optional ffmpeg-static package, if any. */
async function bundledFfmpeg(): Promise<string | null> {
  try {
    return (await import("ffmpeg-static")).default ?? null;
  } catch {
    return null;
  }
}

/** FFMPEG_BIN when set; otherwise ffmpeg on PATH, then the bundled copy. Rechecked every minute. */
async function ffmpegBinary(): Promise<string | null> {
  if (resolved && Date.now() - resolved.at < 60_000) return resolved.bin;
  const candidates = serverConfig.ffmpegBin ? [serverConfig.ffmpegBin] : ["ffmpeg", await bundledFfmpeg()];
  let bin: string | null = null;
  for (const candidate of candidates) {
    if (candidate && (await runs(candidate))) {
      bin = candidate;
      break;
    }
  }
  resolved = { bin, at: Date.now() };
  return bin;
}

export async function hasFfmpeg(): Promise<boolean> {
  return (await ffmpegBinary()) !== null;
}

function argsFor(format: ConvertFormat, input: string, output: string): string[] {
  const common = ["-y", "-hide_banner", "-loglevel", "error", "-nostdin"];
  if (format === "m4a") {
    return [...common, "-i", input, "-vn", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-f", "mp4", output];
  }
  // A real H.264 video: a still cover image for the length of the audio.
  // Still images compress to almost nothing with -tune stillimage.
  const cover = existsSync(serverConfig.videoCover) ? ["-loop", "1", "-framerate", "2", "-i", serverConfig.videoCover] : ["-f", "lavfi", "-i", "color=c=0x0f766e:s=1280x720:r=2"];
  return [
    ...common,
    ...cover,
    "-i", input,
    "-map", "0:v:0", "-map", "1:a:0",
    "-c:v", "libx264", "-tune", "stillimage", "-preset", "veryfast", "-crf", "28",
    "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
    "-r", "24",
    "-c:a", "aac", "-b:a", "128k",
    "-shortest",
    "-movflags", "+faststart",
    output,
  ];
}

export async function convertAudio(mp3: Uint8Array, format: ConvertFormat, signal?: AbortSignal): Promise<Buffer> {
  const bin = await ffmpegBinary();
  if (!bin) throw new ConvertError("NOT_INSTALLED");
  const release = await slots.acquire(signal).catch(() => {
    throw new ConvertError("ABORTED");
  });
  try {
    return await withTempDir(async (dir) => {
      const input = path.join(dir, "input.mp3");
      const output = path.join(dir, `output.${format}`);
      await writeFile(input, mp3);
      let result;
      try {
        result = await runProcess(bin, argsFor(format, input, output), { signal, timeoutMs: LIMITS.convertTimeoutMs });
      } catch (e) {
        if (e instanceof ProcessError && e.reason === "ABORTED") throw new ConvertError("ABORTED");
        if (e instanceof ProcessError && e.reason === "TIMEOUT") throw new ConvertError("TIMEOUT");
        if (e instanceof ProcessError && e.reason === "NOT_FOUND") throw new ConvertError("NOT_INSTALLED");
        throw new ConvertError("FAILED", (e as Error).message);
      }
      if (result.code !== 0) throw new ConvertError("FAILED", result.stderr.trim().slice(0, 300));
      const out = await readFile(output);
      if (out.length < 500) throw new ConvertError("FAILED", "output too small");
      return out;
    });
  } finally {
    release();
  }
}

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { serverConfig } from "./config";
import { ProcessError, runProcess, withTempDir } from "./process";
import { Semaphore } from "./semaphore";

export type EdgeErrorCode = "ENGINE_NOT_INSTALLED" | "NO_AUDIO" | "ENGINE_UNAVAILABLE" | "TIMEOUT" | "ABORTED";

export class EdgeError extends Error {
  constructor(public code: EdgeErrorCode, message?: string) {
    super(message ?? code);
  }
}

const slots = new Semaphore(serverConfig.ttsMaxConcurrency);

/**
 * Synthesizes one chunk with Microsoft Edge neural TTS (through the edge-tts
 * Python package). Text is passed in a temp file, never on the command line.
 */
export async function synthesizeEdge(opts: {
  text: string;
  voice: string;
  rate: string;
  pitch: string;
  signal?: AbortSignal;
}): Promise<Buffer> {
  const release = await slots.acquire(opts.signal).catch(() => {
    throw new EdgeError("ABORTED");
  });
  try {
    return await withTempDir(async (dir) => {
      const textFile = path.join(dir, "input.txt");
      const outFile = path.join(dir, "output.mp3");
      await writeFile(textFile, opts.text, "utf8");
      let result;
      try {
        result = await runProcess(
          serverConfig.pythonBin,
          [
            serverConfig.synthScript,
            "--voice", opts.voice,
            "--rate", opts.rate,
            "--pitch", opts.pitch,
            "--text-file", textFile,
            "--out", outFile,
            "--timeout", String(serverConfig.edgeTimeoutSec),
          ],
          { signal: opts.signal, timeoutMs: (serverConfig.edgeTimeoutSec + 15) * 1000 },
        );
      } catch (e) {
        if (e instanceof ProcessError) {
          if (e.reason === "ABORTED") throw new EdgeError("ABORTED");
          if (e.reason === "TIMEOUT") throw new EdgeError("TIMEOUT");
          if (e.reason === "NOT_FOUND") throw new EdgeError("ENGINE_NOT_INSTALLED", `Python not found (${serverConfig.pythonBin})`);
        }
        throw new EdgeError("ENGINE_UNAVAILABLE", (e as Error).message);
      }
      switch (result.code) {
        case 0:
          return await readFile(outFile);
        case 3:
          throw new EdgeError("NO_AUDIO", result.stderr.trim().slice(0, 300));
        case 4:
          throw new EdgeError("ENGINE_NOT_INSTALLED", "The edge-tts Python package is not installed");
        case 5:
          throw new EdgeError("TIMEOUT");
        default:
          throw new EdgeError("ENGINE_UNAVAILABLE", result.stderr.trim().slice(0, 300) || `exit ${result.code}`);
      }
    });
  } finally {
    release();
  }
}

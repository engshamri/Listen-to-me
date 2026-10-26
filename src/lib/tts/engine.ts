/**
 * Client-side generation engine.
 *
 *  - Chunks are synthesized with bounded concurrency and kept in order.
 *  - Retryable failures are retried with backoff; HTTP 429 waits for the
 *    server's Retry-After without counting as a failure.
 *  - A failure stops scheduling new chunks but keeps every finished chunk,
 *    so the job can resume from where it stopped.
 *  - The backup engine is only used when the caller sets `allowBackup`
 *    (i.e. after the user explicitly agreed); parts it reads are recorded.
 *  - Aborting cancels every in-flight request; the server then closes its
 *    connection to the speech service.
 *  - Each chunk comes back with its word timings (for read-along), when the
 *    voice provides them.
 */

import type { SpeechWord } from "@/lib/text/align";

export type EngineKind = "edge" | "backup";

export type GenerationErrorCode =
  | "ENGINE_UNAVAILABLE"
  | "RATE_LIMITED"
  | "INVALID_INPUT"
  | "TEXT_TOO_LONG"
  | "NO_AUDIO"
  | "NETWORK"
  | "UNKNOWN";

export interface JobSettings {
  voiceId: string;
  rate: string;
  pitch: string;
}

export interface Job {
  settings: JobSettings;
  chunks: string[];
  audio: (ArrayBuffer | null)[];
  /** Word timings per chunk, relative to that chunk's audio; null when none were sent. */
  words: (SpeechWord[] | null)[];
  engines: (EngineKind | null)[];
  allowBackup: boolean;
}

export class GenerationError extends Error {
  constructor(
    public code: GenerationErrorCode,
    public index: number,
    public fallbackAvailable: boolean,
  ) {
    super(code);
  }
}

class ChunkError extends Error {
  constructor(
    public code: GenerationErrorCode,
    public retryable: boolean,
    public fallbackAvailable = false,
    public retryAfter = 0,
  ) {
    super(code);
  }
}

export function createJob(settings: JobSettings, chunks: string[]): Job {
  return { settings, chunks, audio: chunks.map(() => null), words: chunks.map(() => null), engines: chunks.map(() => null), allowBackup: false };
}

export function completedCount(job: Job): number {
  return job.audio.filter(Boolean).length;
}

/** Number of finished chunks before the first gap (what a partial result can safely contain). */
export function contiguousPrefix(job: Job): number {
  const i = job.audio.findIndex((a) => !a);
  return i === -1 ? job.audio.length : i;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });

interface ChunkAudio {
  audio: ArrayBuffer;
  words: SpeechWord[] | null;
}

/** The server answers with plain MP3, or with multipart "audio" + "words" when timings were requested. */
async function readSpeech(res: Response): Promise<ChunkAudio> {
  if (!(res.headers.get("Content-Type") ?? "").startsWith("multipart/form-data")) return { audio: await res.arrayBuffer(), words: null };
  const form = await res.formData();
  const audio = form.get("audio");
  const words = form.get("words");
  return {
    audio: audio instanceof Blob ? await audio.arrayBuffer() : new ArrayBuffer(0),
    words: typeof words === "string" ? (JSON.parse(words) as SpeechWord[]) : null,
  };
}

async function requestChunk(text: string, settings: JobSettings, engine: EngineKind, signal: AbortSignal): Promise<ChunkAudio> {
  let res: Response;
  try {
    res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: settings.voiceId, rate: settings.rate, pitch: settings.pitch, engine, marks: true }),
      signal,
    });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new ChunkError("NETWORK", true);
  }
  if (res.ok) {
    let speech: ChunkAudio;
    try {
      speech = await readSpeech(res);
    } catch (e) {
      if (signal.aborted) throw e;
      throw new ChunkError("NETWORK", true);
    }
    if (speech.audio.byteLength < 300) throw new ChunkError("NO_AUDIO", false);
    return speech;
  }
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; fallbackAvailable?: boolean; retryAfter?: number } };
  const code = body.error?.code;
  const fallback = Boolean(body.error?.fallbackAvailable);
  switch (code) {
    case "RATE_LIMITED":
      throw new ChunkError("RATE_LIMITED", true, false, body.error?.retryAfter ?? Number(res.headers.get("Retry-After") ?? 5));
    case "NO_AUDIO":
      throw new ChunkError("NO_AUDIO", false, fallback);
    case "TEXT_TOO_LONG":
      throw new ChunkError("TEXT_TOO_LONG", false);
    case "INVALID_INPUT":
    case "BACKUP_UNAVAILABLE":
      throw new ChunkError("INVALID_INPUT", false);
    case "ENGINE_UNAVAILABLE":
      throw new ChunkError("ENGINE_UNAVAILABLE", true, fallback);
    default:
      throw new ChunkError(res.status >= 500 ? "ENGINE_UNAVAILABLE" : "UNKNOWN", res.status >= 500);
  }
}

export interface RunOptions {
  signal: AbortSignal;
  concurrency?: number;
  maxAttempts?: number;
  onProgress?: (done: number, total: number) => void;
  /** Called with seconds to wait when the server asks us to slow down (0 when resuming). */
  onWait?: (seconds: number) => void;
}

/** Synthesizes every chunk that has no audio yet. Resolves when all are done. */
export async function runJob(job: Job, { signal, concurrency = 3, maxAttempts = 3, onProgress, onWait }: RunOptions): Promise<void> {
  const pending = job.audio.map((a, i) => (a ? -1 : i)).filter((i) => i >= 0);
  let cursor = 0;
  // Held in an object because workers assign it from inside async closures.
  const state: { failure: GenerationError | null } = { failure: null };
  const total = job.chunks.length;
  const recordFailure = (e: GenerationError) => {
    if (!state.failure || e.index < state.failure.index) state.failure = e;
  };

  async function synthesize(index: number): Promise<void> {
    let attempt = 0;
    let rateWaits = 0;
    for (;;) {
      try {
        const speech = await requestChunk(job.chunks[index], job.settings, "edge", signal);
        job.audio[index] = speech.audio;
        job.words[index] = speech.words;
        job.engines[index] = "edge";
        return;
      } catch (e) {
        if (signal.aborted || !(e instanceof ChunkError)) throw e;
        if (e.code === "RATE_LIMITED" && rateWaits < 6) {
          rateWaits++;
          onWait?.(e.retryAfter);
          await sleep(Math.min(60, e.retryAfter) * 1000, signal);
          onWait?.(0);
          continue;
        }
        attempt++;
        if (e.retryable && attempt < maxAttempts) {
          await sleep(1000 * attempt * attempt, signal);
          continue;
        }
        if (job.allowBackup && e.fallbackAvailable) {
          try {
            const speech = await requestChunk(job.chunks[index], job.settings, "backup", signal);
            job.audio[index] = speech.audio;
            job.words[index] = speech.words;
            job.engines[index] = "backup";
            return;
          } catch (backupErr) {
            if (signal.aborted) throw backupErr;
          }
        }
        throw new GenerationError(e.code, index, e.fallbackAvailable);
      }
    }
  }

  async function worker(): Promise<void> {
    while (!state.failure && cursor < pending.length) {
      const index = pending[cursor++];
      try {
        await synthesize(index);
        onProgress?.(completedCount(job), total);
      } catch (e) {
        if (e instanceof GenerationError) {
          recordFailure(e);
          return;
        }
        throw e;
      }
    }
  }

  onProgress?.(completedCount(job), total);
  const workers = Array.from({ length: Math.min(concurrency, pending.length) }, worker);
  const results = await Promise.allSettled(workers);
  const crashed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (crashed) throw crashed.reason;
  if (state.failure) throw state.failure;
}

/** Joins finished chunks into one MP3 (all chunks share the same codec settings). */
export function assemble(job: Job, upTo = job.audio.length): Blob {
  const parts = job.audio.slice(0, upTo).filter((a): a is ArrayBuffer => a !== null);
  return new Blob(parts, { type: "audio/mpeg" });
}

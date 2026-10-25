import { afterEach, describe, expect, it, vi } from "vitest";
import { GenerationError, assemble, completedCount, contiguousPrefix, createJob, runJob } from "@/lib/tts/engine";

type Reply = { status: number; body?: unknown; audio?: number };

/** Fake /api/tts: `script(chunkText, engine, attempt)` decides each reply. */
function mockTts(script: (text: string, engine: string, attempt: number) => Reply) {
  const attempts = new Map<string, number>();
  const calls: { text: string; engine: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const body = JSON.parse(String(init.body));
    const key = `${body.text}|${body.engine}`;
    const attempt = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, attempt);
    calls.push({ text: body.text, engine: body.engine });
    const r = script(body.text, body.engine, attempt);
    if (r.status === 200) return new Response(new Uint8Array(r.audio ?? 1000).fill(body.text.charCodeAt(0)), { status: 200 });
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
  return calls;
}

const settings = { voiceId: "ar-IQ-RanaNeural", rate: "+0%", pitch: "+0Hz" };
const fast = { maxAttempts: 2 };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("generation engine", () => {
  it("synthesizes every chunk and assembles them in order", async () => {
    mockTts(() => ({ status: 200 }));
    const job = createJob(settings, ["a", "b", "c", "d", "e"]);
    const progress: number[] = [];
    await runJob(job, { signal: new AbortController().signal, concurrency: 3, onProgress: (d) => progress.push(d) });
    expect(completedCount(job)).toBe(5);
    expect(job.engines.every((e) => e === "edge")).toBe(true);
    const bytes = new Uint8Array(await assemble(job).arrayBuffer());
    expect([0, 1000, 2000, 3000, 4000].map((i) => String.fromCharCode(bytes[i]))).toEqual(["a", "b", "c", "d", "e"]);
    expect(progress.at(-1)).toBe(5);
  });

  it("retries transient failures", async () => {
    mockTts((_t, _e, attempt) => (attempt === 1 ? { status: 502, body: { error: { code: "ENGINE_UNAVAILABLE" } } } : { status: 200 }));
    const job = createJob(settings, ["a", "b"]);
    await runJob(job, { signal: new AbortController().signal, ...fast });
    expect(completedCount(job)).toBe(2);
  }, 10_000);

  it("keeps finished chunks when one fails, then resumes only the missing ones", async () => {
    let broken = true;
    const calls = mockTts((text) => (text === "c" && broken ? { status: 502, body: { error: { code: "ENGINE_UNAVAILABLE", fallbackAvailable: true } } } : { status: 200 }));
    const job = createJob(settings, ["a", "b", "c", "d", "e", "f"]);
    const err = await runJob(job, { signal: new AbortController().signal, concurrency: 1, ...fast }).catch((e) => e);
    expect(err).toBeInstanceOf(GenerationError);
    expect(err.index).toBe(2);
    expect(err.fallbackAvailable).toBe(true);
    expect(contiguousPrefix(job)).toBe(2); // a, b kept
    expect(job.audio[2]).toBeNull();

    broken = false;
    const before = calls.length;
    await runJob(job, { signal: new AbortController().signal, concurrency: 1, ...fast });
    expect(completedCount(job)).toBe(6);
    expect(calls.slice(before).map((c) => c.text)).toEqual(["c", "d", "e", "f"]); // a and b not regenerated
  }, 10_000);

  it("never uses the backup voice without consent, and records it when allowed", async () => {
    const calls = mockTts((text, engine) =>
      text === "b" && engine === "edge" ? { status: 502, body: { error: { code: "ENGINE_UNAVAILABLE", fallbackAvailable: true } } } : { status: 200 },
    );
    const job = createJob(settings, ["a", "b", "c"]);
    await expect(runJob(job, { signal: new AbortController().signal, concurrency: 1, ...fast })).rejects.toBeInstanceOf(GenerationError);
    expect(calls.some((c) => c.engine === "backup")).toBe(false);

    job.allowBackup = true;
    await runJob(job, { signal: new AbortController().signal, concurrency: 1, ...fast });
    expect(job.engines).toEqual(["edge", "backup", "edge"]);
  }, 10_000);

  it("does not retry permanent errors", async () => {
    const calls = mockTts(() => ({ status: 503, body: { error: { code: "ENGINE_NOT_INSTALLED" } } }));
    const job = createJob(settings, ["a"]);
    const err = await runJob(job, { signal: new AbortController().signal, maxAttempts: 3 }).catch((e) => e);
    expect(err.code).toBe("ENGINE_NOT_INSTALLED");
    expect(calls.length).toBe(1);
  });

  it("waits for Retry-After on 429 without counting it as a failure", async () => {
    vi.useFakeTimers();
    mockTts((_t, _e, attempt) => (attempt <= 2 ? { status: 429, body: { error: { code: "RATE_LIMITED", retryAfter: 2 } } } : { status: 200 }));
    const job = createJob(settings, ["a"]);
    const waits: number[] = [];
    const p = runJob(job, { signal: new AbortController().signal, maxAttempts: 1, onWait: (s) => waits.push(s) });
    await vi.advanceTimersByTimeAsync(5000);
    await p;
    expect(completedCount(job)).toBe(1);
    expect(waits).toEqual([2, 0, 2, 0]);
  });

  it("stops immediately when cancelled", async () => {
    vi.stubGlobal("fetch", vi.fn((_u: string, init: RequestInit) => new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))))));
    const job = createJob(settings, ["a", "b", "c"]);
    const ctrl = new AbortController();
    const p = runJob(job, { signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(completedCount(job)).toBe(0);
  });
});

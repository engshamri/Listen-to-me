import { describe, expect, it } from "vitest";
import { downloadName } from "@/lib/audio/filename";
import { countMp3Frames, looksLikeMp3, mp3DurationSeconds } from "@/lib/audio/mp3";
import { splitForBackup } from "@/lib/server/backup-tts";
import { BodyTooLargeError, clientKey, crossSiteRejection, readBodyLimited } from "@/lib/server/http";
import { rateLimit, resetRateLimits, trackedKeys } from "@/lib/server/rate-limit";
import { Semaphore } from "@/lib/server/semaphore";

/** One MPEG-2 Layer III frame header: 24 kHz, 48 kbps, mono (Edge TTS output format). */
function frame(): number[] {
  const len = Math.floor((72 * 48000) / 24000); // 144 bytes
  return [0xff, 0xf3, 0x64, 0xc4, ...new Array(len - 4).fill(0)];
}

describe("MP3 helpers", () => {
  it("recognises MP3 data and rejects other bytes", () => {
    expect(looksLikeMp3(new Uint8Array(frame()))).toBe(true);
    expect(looksLikeMp3(new TextEncoder().encode("ID3\u0004..."))).toBe(true);
    expect(looksLikeMp3(new TextEncoder().encode("#!/bin/sh echo hi"))).toBe(false);
  });

  it("measures duration from frames", () => {
    const bytes = new Uint8Array(Array.from({ length: 100 }, frame).flat());
    expect(countMp3Frames(bytes)).toBe(100);
    expect(mp3DurationSeconds(bytes)).toBeCloseTo(100 * (576 / 24000), 5); // 2.4 s
  });
});

describe("rate limiter", () => {
  it("allows up to the limit per window, then reports retry-after", () => {
    resetRateLimits();
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect(rateLimit("x", "ip", 3, 60_000, t0 + i).ok).toBe(true);
    const blocked = rateLimit("x", "ip", 3, 60_000, t0 + 10);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBe(60);
    expect(rateLimit("x", "other-ip", 3, 60_000, t0 + 10).ok).toBe(true);
    expect(rateLimit("x", "ip", 3, 60_000, t0 + 61_000).ok).toBe(true);
  });

  it("keeps a bounded number of callers in memory", () => {
    resetRateLimits();
    const t0 = 2_000_000;
    for (let i = 0; i < 10_050; i++) rateLimit("x", `ip-${i}`, 5, 60_000, t0);
    expect(trackedKeys()).toBeLessThanOrEqual(10_000);
    resetRateLimits();
  });
});

describe("caller identity and cross-site protection", () => {
  const req = (headers: Record<string, string>) => new Request("http://127.0.0.1:3000/api/tts", { method: "POST", headers });

  it("ignores spoofable forwarding headers unless a trusted proxy is configured", () => {
    const spoofed = req({ "x-forwarded-for": "1.2.3.4" });
    expect(clientKey(spoofed, false)).toBe("local");
    expect(clientKey(spoofed, true)).toBe("1.2.3.4");
  });

  it("allows same-origin browser requests and non-browser clients", () => {
    expect(crossSiteRejection(req({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" }), false)).toBeNull();
    expect(crossSiteRejection(req({ host: "127.0.0.1:3000" }), false)).toBeNull();
    // Opening a preview URL directly in the address bar.
    expect(crossSiteRejection(req({ host: "127.0.0.1:3000", "sec-fetch-site": "none" }), false)).toBeNull();
  });

  it("rejects requests sent by other websites", () => {
    expect(crossSiteRejection(req({ host: "127.0.0.1:3000", origin: "https://evil.example", "sec-fetch-site": "cross-site" }), false)?.status).toBe(403);
    // Another local app on a different port is same-site but not same-origin.
    expect(crossSiteRejection(req({ host: "localhost:3000", origin: "http://localhost:5173", "sec-fetch-site": "same-site" }), false)?.status).toBe(403);
    // Older browsers without Sec-Fetch-* still send Origin.
    expect(crossSiteRejection(req({ host: "127.0.0.1:3000", origin: "https://evil.example" }), false)?.status).toBe(403);
    expect(crossSiteRejection(req({ host: "127.0.0.1:3000", origin: "null" }), false)?.status).toBe(403);
  });

  it("compares against the public host behind a trusted proxy", () => {
    const proxied = req({ host: "127.0.0.1:3000", "x-forwarded-host": "listen.example.com", origin: "https://listen.example.com", "sec-fetch-site": "same-origin" });
    expect(crossSiteRejection(proxied, true)).toBeNull();
    expect(crossSiteRejection(proxied, false)?.status).toBe(403);
  });
});

describe("semaphore", () => {
  it("never runs more than the limit at once", async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        const release = await sem.acquire();
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        release();
      }),
    );
    expect(peak).toBe(2);
  });

  it("drops queued waiters when their request is aborted", async () => {
    const sem = new Semaphore(1);
    const release = await sem.acquire();
    const ctrl = new AbortController();
    const waiting = sem.acquire(ctrl.signal);
    ctrl.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    release();
    const again = await sem.acquire();
    again();
  });
});

describe("request body limits", () => {
  it("refuses bodies over the limit without buffering them", async () => {
    const req = new Request("http://x/", { method: "POST", body: "x".repeat(2000) });
    await expect(readBodyLimited(req, 1000)).rejects.toBeInstanceOf(BodyTooLargeError);
    const ok = new Request("http://x/", { method: "POST", body: "hello" });
    expect(new TextDecoder().decode(await readBodyLimited(ok, 1000))).toBe("hello");
  });
});

describe("backup voice splitting", () => {
  it("splits at spaces and never loses words", () => {
    const words = Array.from({ length: 200 }, (_, i) => `كلمة${i}`);
    const pieces = splitForBackup(words.join(" "));
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(180);
    expect(pieces.join(" ").split(" ")).toEqual(words);
  });
});

describe("download names", () => {
  it("are ASCII, descriptive and timestamped to the second", () => {
    const name = downloadName("Rana", "ar-IQ", new Date(2026, 9, 25, 14, 3, 9), "mp3");
    expect(name).toBe("listen-to-me_rana_ar-IQ_2026-10-25_14-03-09.mp3");
  });
});

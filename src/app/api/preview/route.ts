import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { serverConfig } from "@/lib/server/config";
import { synthesizeEdge } from "@/lib/server/edge";
import { apiError, clientKey, crossSiteRejection } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import { translateText } from "@/lib/server/translate";
import { getVoice, type Voice } from "@/lib/voices/catalog";
import { PREVIEW_SAMPLES, sampleFor } from "@/lib/voices/samples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const inflight = new Map<string, Promise<Buffer>>();

async function sampleText(voice: Voice): Promise<string> {
  const sample = sampleFor(voice.locale, voice.lang);
  if (sample) return sample.replace("{name}", voice.name);
  // No hand-written sentence for this language: machine-translate the English one.
  const english = PREVIEW_SAMPLES.en.replace("{name}", voice.name);
  return (await translateText(english, "en", voice.lang)).text;
}

async function generate(voice: Voice, file: string): Promise<Buffer> {
  const text = await sampleText(voice);
  const audio = await synthesizeEdge({ text, voice: voice.id, rate: "+0%", pitch: "+0Hz" });
  // Caching is best effort: a read-only or full disk must not cost the visitor the preview.
  try {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, audio);
    await rename(tmp, file);
  } catch {}
  return audio;
}

function mp3(buf: Buffer) {
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(buf.length),
      // Samples are fixed sentences, so a CDN (Vercel's included) may keep them until the next deploy.
      "Cache-Control": "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400",
    },
  });
}

export async function GET(req: NextRequest) {
  const crossSite = crossSiteRejection(req);
  if (crossSite) return crossSite;
  const voice = getVoice(req.nextUrl.searchParams.get("voice"));
  if (!voice || !/^[\w-]+$/.test(voice.id)) return apiError("INVALID_INPUT", 400, "Unknown voice");

  // Voice ids come from our catalog and match [\w-]+, so this path cannot escape the cache dir.
  const file = path.join(serverConfig.previewCacheDir, `${voice.id}.mp3`);
  try {
    return mp3(await readFile(file));
  } catch {
    // not cached yet
  }

  const limit = rateLimit("preview", clientKey(req), serverConfig.rateLimits.preview);
  if (!limit.ok) return apiError("RATE_LIMITED", 429, "Too many requests", { retryAfter: limit.retryAfter });

  let job = inflight.get(voice.id);
  if (!job) {
    job = generate(voice, file).finally(() => inflight.delete(voice.id));
    inflight.set(voice.id, job);
  }
  try {
    return mp3(await job);
  } catch {
    return apiError("PREVIEW_UNAVAILABLE", 503, "Preview unavailable");
  }
}

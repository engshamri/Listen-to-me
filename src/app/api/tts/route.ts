import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { synthesizeBackup } from "@/lib/server/backup-tts";
import { LIMITS, serverConfig } from "@/lib/server/config";
import { EdgeError, synthesizeEdge } from "@/lib/server/edge";
import { apiError, BodyTooLargeError, clientKey, crossSiteRejection, readJsonLimited } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import { getVoice, isKnownVoice } from "@/lib/voices/catalog";
import { backupLanguageFor } from "@/lib/voices/fallback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inRange = (min: number, max: number) => (v: string) => {
  const n = Number.parseInt(v, 10);
  return n >= min && n <= max;
};

const Body = z.object({
  text: z.string(),
  voice: z.string().refine(isKnownVoice, "Unknown voice"),
  rate: z.string().regex(/^[+-]\d{1,3}%$/).refine(inRange(-50, 100)).default("+0%"),
  pitch: z.string().regex(/^[+-]\d{1,3}Hz$/).refine(inRange(-50, 50)).default("+0Hz"),
  engine: z.enum(["edge", "backup"]).default("edge"),
});

function audio(buf: Buffer, engine: string) {
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(buf.length),
      "X-Engine": engine,
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(req: NextRequest) {
  const crossSite = crossSiteRejection(req);
  if (crossSite) return crossSite;
  const limit = rateLimit("tts", clientKey(req), serverConfig.rateLimits.tts);
  if (!limit.ok) return apiError("RATE_LIMITED", 429, "Too many requests", { retryAfter: limit.retryAfter });

  let raw: unknown;
  try {
    raw = await readJsonLimited(req, LIMITS.ttsBodyBytes);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return apiError("PAYLOAD_TOO_LARGE", 413, "Request body too large");
    return apiError("INVALID_INPUT", 400, "Body must be JSON");
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return apiError("INVALID_INPUT", 400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const { text, voice: voiceId, rate, pitch, engine } = parsed.data;
  if (!text.trim()) return apiError("INVALID_INPUT", 400, "Text is empty");
  if (text.length > LIMITS.ttsChunkChars) return apiError("TEXT_TOO_LONG", 413, `At most ${LIMITS.ttsChunkChars} characters per request`);

  const voice = getVoice(voiceId)!;
  const backupLang = serverConfig.backupVoiceEnabled ? backupLanguageFor(voice.locale) : null;

  if (engine === "backup") {
    if (!backupLang) return apiError("BACKUP_UNAVAILABLE", 400, "No backup voice for this language");
    try {
      return audio(await synthesizeBackup(text, backupLang, req.signal), "backup");
    } catch {
      if (req.signal.aborted) return new Response(null, { status: 499 });
      return apiError("ENGINE_UNAVAILABLE", 502, "Backup voice unavailable", { fallbackAvailable: false });
    }
  }

  try {
    return audio(await synthesizeEdge({ text, voice: voice.id, rate, pitch, signal: req.signal }), "edge");
  } catch (e) {
    const code = e instanceof EdgeError ? e.code : "ENGINE_UNAVAILABLE";
    if (code === "ABORTED") return new Response(null, { status: 499 });
    if (code !== "TIMEOUT") console.warn(`[tts] ${voice.id}: ${code} ${(e as Error).message}`);
    if (code === "ENGINE_NOT_INSTALLED") return apiError("ENGINE_NOT_INSTALLED", 503, (e as Error).message);
    if (code === "NO_AUDIO") return apiError("NO_AUDIO", 422, "The voice produced no audio for this text", { fallbackAvailable: Boolean(backupLang) });
    return apiError("ENGINE_UNAVAILABLE", 502, "The speech service did not respond", { fallbackAvailable: Boolean(backupLang) });
  }
}

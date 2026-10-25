import { NextResponse, type NextRequest } from "next/server";
import { looksLikeMp3 } from "@/lib/audio/mp3";
import { LIMITS, serverConfig } from "@/lib/server/config";
import { ConvertError, convertAudio, hasFfmpeg, type ConvertFormat } from "@/lib/server/ffmpeg";
import { apiError, BodyTooLargeError, clientKey, crossSiteRejection, readBodyLimited } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<ConvertFormat, string> = { m4a: "audio/mp4", mp4: "video/mp4" };

/**
 * POST an MP3 body to /api/convert?format=m4a|mp4.
 *  - m4a: audio-only AAC in an MP4 container (honestly labelled as M4A)
 *  - mp4: a real H.264 video with a still cover image and the audio track
 */
export async function POST(req: NextRequest) {
  const crossSite = crossSiteRejection(req);
  if (crossSite) return crossSite;
  const format = req.nextUrl.searchParams.get("format");
  if (format !== "m4a" && format !== "mp4") return apiError("INVALID_INPUT", 400, "format must be m4a or mp4");

  const limit = rateLimit("convert", clientKey(req), serverConfig.rateLimits.convert);
  if (!limit.ok) return apiError("RATE_LIMITED", 429, "Too many requests", { retryAfter: limit.retryAfter });

  if (!(await hasFfmpeg())) return apiError("CONVERTER_NOT_INSTALLED", 503, "ffmpeg is not installed");

  let bytes: Uint8Array;
  try {
    bytes = await readBodyLimited(req, LIMITS.convertBodyBytes);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return apiError("PAYLOAD_TOO_LARGE", 413, "Audio too large to convert");
    return apiError("INVALID_INPUT", 400, "Could not read body");
  }
  if (!looksLikeMp3(bytes)) return apiError("UNSUPPORTED_MEDIA", 415, "Body must be MP3 audio");

  try {
    const out = await convertAudio(bytes, format, req.signal);
    return new NextResponse(new Uint8Array(out), {
      headers: { "Content-Type": CONTENT_TYPES[format], "Content-Length": String(out.length), "Cache-Control": "no-store" },
    });
  } catch (e) {
    const code = e instanceof ConvertError ? e.code : "FAILED";
    if (code === "ABORTED") return new Response(null, { status: 499 });
    if (code === "NOT_INSTALLED") return apiError("CONVERTER_NOT_INSTALLED", 503, "ffmpeg is not installed");
    console.warn("[convert]", (e as Error).message);
    return apiError("CONVERSION_FAILED", 500, "Conversion failed");
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { LIMITS, serverConfig } from "@/lib/server/config";
import { apiError, BodyTooLargeError, clientKey, crossSiteRejection, readJsonLimited } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import { detectLanguage, translateText } from "@/lib/server/translate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LANG = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

const Body = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("detect"), text: z.string().min(1).max(LIMITS.translateRequestChars) }),
  z.object({
    mode: z.literal("translate"),
    text: z.string().min(1).max(LIMITS.translateRequestChars),
    source: z.string().regex(LANG).or(z.literal("auto")).default("auto"),
    target: z.string().regex(LANG),
  }),
]);

export async function POST(req: NextRequest) {
  const crossSite = crossSiteRejection(req);
  if (crossSite) return crossSite;
  const limit = rateLimit("translate", clientKey(req), serverConfig.rateLimits.translate);
  if (!limit.ok) return apiError("RATE_LIMITED", 429, "Too many requests", { retryAfter: limit.retryAfter });

  let raw: unknown;
  try {
    raw = await readJsonLimited(req, LIMITS.translateBodyBytes);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return apiError("PAYLOAD_TOO_LARGE", 413, "Request body too large");
    return apiError("INVALID_INPUT", 400, "Body must be JSON");
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    const tooLong = parsed.error.issues.some((i) => i.code === "too_big");
    return tooLong
      ? apiError("TEXT_TOO_LONG", 413, `At most ${LIMITS.translateRequestChars} characters per request`)
      : apiError("INVALID_INPUT", 400, parsed.error.issues.map((i) => i.message).join("; "));
  }

  try {
    if (parsed.data.mode === "detect") {
      return NextResponse.json({ detectedSource: await detectLanguage(parsed.data.text, req.signal) }, { headers: { "Cache-Control": "no-store" } });
    }
    const { text, source, target } = parsed.data;
    const result = await translateText(text, source, target, req.signal);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    console.warn("[translate]", (e as Error).message);
    return apiError("TRANSLATION_FAILED", 502, "Translation service unavailable");
  }
}

import { NextResponse } from "next/server";
import { serverConfig } from "./config";

export type ApiErrorCode =
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "TEXT_TOO_LONG"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "ENGINE_UNAVAILABLE"
  | "ENGINE_NOT_INSTALLED"
  | "NO_AUDIO"
  | "BACKUP_UNAVAILABLE"
  | "PREVIEW_UNAVAILABLE"
  | "TRANSLATION_FAILED"
  | "CONVERTER_NOT_INSTALLED"
  | "CONVERSION_FAILED"
  | "UNSUPPORTED_MEDIA"
  | "INTERNAL";

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; retryAfter?: number; fallbackAvailable?: boolean };
}

export function apiError(
  code: ApiErrorCode,
  status: number,
  message: string,
  extra: Partial<ApiErrorBody["error"]> = {},
): NextResponse<ApiErrorBody> {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (extra.retryAfter) headers["Retry-After"] = String(extra.retryAfter);
  return NextResponse.json({ error: { code, message, ...extra } }, { status, headers });
}

/**
 * Identifies the caller for rate limiting. Forwarding headers are only
 * believed when TRUST_PROXY=true (a reverse proxy that overwrites them sits in
 * front of the app); otherwise any client could send a new fake address with
 * every request and never be limited. Without a proxy, Next.js route handlers
 * cannot see the socket address, so all callers share one "local" budget.
 */
export function clientKey(req: Request, trustProxy = serverConfig.trustProxy): string {
  if (!trustProxy) return "local";
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim().slice(0, 64);
  return req.headers.get("x-real-ip")?.slice(0, 64) ?? "local";
}

/**
 * Refuses requests made by another website in the user's browser (for example
 * a page that POSTs to http://localhost:3000/api/tts). Browsers label such
 * requests with Sec-Fetch-Site and Origin; scripts and command-line tools send
 * neither and are allowed, so the API stays usable locally.
 */
export function crossSiteRejection(req: Request, trustProxy = serverConfig.trustProxy): NextResponse<ApiErrorBody> | null {
  const site = req.headers.get("sec-fetch-site");
  const forbidden = () => apiError("FORBIDDEN", 403, "Cross-site requests are not allowed");
  if (site && site !== "same-origin" && site !== "none") return forbidden();
  const origin = req.headers.get("origin");
  if (!origin) return null;
  const host = (trustProxy && req.headers.get("x-forwarded-host")?.split(",")[0].trim()) || req.headers.get("host");
  try {
    return new URL(origin).host === host ? null : forbidden();
  } catch {
    return forbidden();
  }
}

export class BodyTooLargeError extends Error {}

/** Reads a request body, refusing to buffer more than `maxBytes`. */
export async function readBodyLimited(req: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new BodyTooLargeError();
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export async function readJsonLimited(req: Request, maxBytes: number): Promise<unknown> {
  const bytes = await readBodyLimited(req, maxBytes);
  return JSON.parse(new TextDecoder().decode(bytes));
}

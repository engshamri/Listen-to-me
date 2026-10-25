import { splitPreservingLines } from "@/lib/text/lines";
import { serverConfig } from "./config";

/**
 * Machine translation. Default provider: Google Translate's free web endpoint
 * (no key). Optional provider: a LibreTranslate server (open source,
 * self-hostable) configured through LIBRETRANSLATE_URL.
 */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const PIECE_CHARS = 4000;

export class TranslationError extends Error {}

export interface TranslationResult {
  text: string;
  detectedSource: string | null;
  provider: string;
}

/** Google reports a few legacy codes; normalize them to BCP 47. */
function normalizeCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const map: Record<string, string> = { iw: "he", jw: "jv", "zh-cn": "zh-CN", "zh-tw": "zh-TW", tl: "fil" };
  return map[code.toLowerCase()] ?? code;
}

function toProviderCode(code: string): string {
  const map: Record<string, string> = { he: "iw", jv: "jw", fil: "tl", nb: "no" };
  return map[code] ?? code;
}

async function googleTranslate(text: string, source: string, target: string, signal?: AbortSignal): Promise<{ text: string; detected: string | null }> {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(source === "auto" ? "auto" : toProviderCode(source))}&tl=${encodeURIComponent(toProviderCode(target))}&dt=t`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ q: text }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new TranslationError(`Google Translate HTTP ${res.status}`);
  const data = (await res.json()) as [Array<[string, string, ...unknown[]]> | null, unknown, string | null];
  if (!Array.isArray(data?.[0])) throw new TranslationError("Unexpected translation response");
  return { text: data[0].map((seg) => seg[0] ?? "").join(""), detected: normalizeCode(data[2]) };
}

async function libreTranslate(text: string, source: string, target: string, signal?: AbortSignal): Promise<{ text: string; detected: string | null }> {
  const res = await fetch(`${serverConfig.libreTranslateUrl.replace(/\/$/, "")}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: text, source, target, format: "text", api_key: serverConfig.libreTranslateKey || undefined }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new TranslationError(`LibreTranslate HTTP ${res.status}`);
  const data = (await res.json()) as { translatedText?: string; detectedLanguage?: { language?: string } };
  if (typeof data.translatedText !== "string") throw new TranslationError("Unexpected translation response");
  return { text: data.translatedText, detected: data.detectedLanguage?.language ?? null };
}

function provider() {
  return serverConfig.translateProvider === "libretranslate" && serverConfig.libreTranslateUrl ? libreTranslate : googleTranslate;
}

export function providerName(): string {
  return serverConfig.translateProvider === "libretranslate" && serverConfig.libreTranslateUrl ? "LibreTranslate" : "Google Translate";
}

export async function translateText(text: string, source: string, target: string, signal?: AbortSignal): Promise<TranslationResult> {
  const translate = provider();
  const leading = /^\s*/.exec(text)![0];
  const trailing = /\s*$/.exec(text)![0];
  const { pieces, separators } = splitPreservingLines(text.trim(), PIECE_CHARS);
  let out = "";
  let detected: string | null = null;
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i].trim();
    if (piece) {
      const r = await translate(piece, source, target, signal);
      detected ??= r.detected;
      out += r.text.trim();
    }
    out += separators[i];
    if (i < pieces.length - 1) await new Promise((r) => setTimeout(r, 150));
  }
  return { text: leading + out + trailing, detectedSource: detected, provider: providerName() };
}

export async function detectLanguage(text: string, signal?: AbortSignal): Promise<string | null> {
  const sample = text.trim().slice(0, 400);
  if (!sample) return null;
  const r = await provider()(sample, "auto", "en", signal);
  return r.detected;
}

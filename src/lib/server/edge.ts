import { randomBytes, randomUUID } from "node:crypto";
import WebSocket from "ws";
import { mp3DurationSeconds } from "@/lib/audio/mp3";
import type { SpeechWord } from "@/lib/text/align";
import { serverConfig } from "./config";
import { adjustClockSkew, CHROMIUM_MAJOR_VERSION, SEC_MS_GEC_VERSION, secMsGec, TRUSTED_CLIENT_TOKEN } from "./edge-drm";
import { Semaphore } from "./semaphore";

export type EdgeErrorCode = "NO_AUDIO" | "ENGINE_UNAVAILABLE" | "TIMEOUT" | "ABORTED";

export class EdgeError extends Error {
  constructor(public code: EdgeErrorCode, message?: string) {
    super(message ?? code);
  }
}

/*
 * Microsoft Edge's read-aloud service, spoken to directly over WebSocket (the
 * same protocol as the edge-tts Python package), so speech works anywhere
 * Node.js runs, including serverless hosts without Python.
 */
const WSS_URL = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const ORIGIN = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";
const USER_AGENT =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
  `Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`;
/** The service accepts at most this many bytes of escaped text per request. */
const MAX_PIECE_BYTES = 4096;
const CONNECT_TIMEOUT_MS = 10_000;
/** The service streams continuously, sometimes slowly; this much silence means it stalled. */
const IDLE_TIMEOUT_MS = 45_000;
/** A real recording is far larger; anything smaller means the service sent no speech. */
const MIN_AUDIO_BYTES = 500;

/** "iu-Cans-CA-SiqiniqNeural" -> "Microsoft Server Speech Text to Speech Voice (iu-Cans-CA, SiqiniqNeural)". */
export function fullVoiceName(id: string): string {
  const cut = id.lastIndexOf("-");
  return `Microsoft Server Speech Text to Speech Voice (${id.slice(0, cut)}, ${id.slice(cut + 1)})`;
}

/** The service rejects most control characters (vertical tabs are common in OCR output). */
export function removeIncompatibleCharacters(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ");
}

export function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Word texts in metadata come back XML-escaped, as they were sent. */
export function unescapeXml(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

/** WordBoundary events from an audio.metadata body; times in seconds (the service counts 100 ns ticks). */
export function parseWordBoundaries(body: string): SpeechWord[] {
  const parsed = JSON.parse(body) as { Metadata?: { Type?: string; Data?: { Offset?: number; Duration?: number; text?: { Text?: string } } }[] };
  const words: SpeechWord[] = [];
  for (const m of parsed.Metadata ?? []) {
    if (m.Type !== "WordBoundary" || !m.Data) continue;
    const start = (m.Data.Offset ?? 0) / 1e7;
    words.push({ start, end: start + (m.Data.Duration ?? 0) / 1e7, text: unescapeXml(m.Data.text?.Text ?? "") });
  }
  return words;
}

export interface Speech {
  audio: Buffer;
  /** When each word is spoken, in seconds from the start of `audio`. */
  words: SpeechWord[];
}

/**
 * Splits escaped text into pieces of at most `maxBytes` UTF-8 bytes, preferring
 * newlines, then spaces, and never cutting a character or an XML entity.
 */
export function splitByBytes(text: string, maxBytes = MAX_PIECE_BYTES): string[] {
  const pieces: string[] = [];
  let rest = Buffer.from(text, "utf8");
  const push = (buf: Buffer) => {
    const piece = buf.toString("utf8").trim();
    if (piece) pieces.push(piece);
  };
  while (rest.length > maxBytes) {
    let at = rest.lastIndexOf(0x0a, maxBytes - 1);
    if (at < 0) at = rest.lastIndexOf(0x20, maxBytes - 1);
    if (at < 0) {
      // No whitespace: back off to the start of a UTF-8 character.
      at = maxBytes;
      while (at > 0 && (rest[at] & 0xc0) === 0x80) at--;
    }
    // Never split inside an entity such as &amp;.
    const amp = at > 0 ? rest.lastIndexOf(0x26, at - 1) : -1;
    const semicolon = amp >= 0 ? rest.indexOf(0x3b, amp) : -1;
    if (amp >= 0 && (semicolon < 0 || semicolon >= at)) at = amp;
    push(rest.subarray(0, at));
    rest = rest.subarray(at > 0 ? at : 1);
  }
  push(rest);
  return pieces;
}

/** JavaScript-style UTC date, as Microsoft Edge sends it. */
export function edgeDate(d = new Date()): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${p(d.getUTCDate())} ${d.getUTCFullYear()} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`
  );
}

export function buildSsml(voiceId: string, rate: string, pitch: string, escapedText: string): string {
  return (
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
    `<voice name='${fullVoiceName(voiceId)}'>` +
    `<prosody pitch='${pitch}' rate='${rate}' volume='+0%'>${escapedText}</prosody>` +
    "</voice></speak>"
  );
}

function parseHeaders(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of block.split("\r\n")) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i)] = line.slice(i + 1);
  }
  return headers;
}

/** Binary frames: a 2-byte big-endian header length, the headers, then the payload. */
export function parseBinaryFrame(data: Buffer): { headers: Record<string, string>; payload: Buffer } {
  if (data.length < 2) throw new Error("binary frame without header length");
  const length = data.readUInt16BE(0);
  if (length + 2 > data.length) throw new Error("binary frame header longer than the frame");
  return { headers: parseHeaders(data.subarray(2, 2 + length).toString("utf8")), payload: data.subarray(2 + length) };
}

class HandshakeRejected extends Error {
  constructor(
    public status: number,
    public date: string | undefined,
  ) {
    super(`handshake rejected (HTTP ${status})`);
  }
}

/** One WebSocket session: sends one piece of text and collects its MP3 frames and word timings. */
function synthesizePiece(piece: string, voiceId: string, rate: string, pitch: string, signal: AbortSignal): Promise<Speech> {
  return new Promise((resolve, reject) => {
    // EDGE_TTS_URL exists for tests, which point it at a local mock service.
    const url =
      `${process.env.EDGE_TTS_URL || WSS_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&ConnectionId=${randomUUID().replace(/-/g, "")}` +
      `&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
    const ws = new WebSocket(url, {
      origin: ORIGIN,
      handshakeTimeout: CONNECT_TIMEOUT_MS,
      headers: {
        Pragma: "no-cache",
        "Cache-Control": "no-cache",
        "User-Agent": USER_AGENT,
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Accept-Language": "en-US,en;q=0.9",
        Cookie: `muid=${randomBytes(16).toString("hex").toUpperCase()};`,
      },
    });
    const audio: Buffer[] = [];
    const words: SpeechWord[] = [];
    let settled = false;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const stillAlive = () => {
      clearTimeout(idle);
      idle = setTimeout(() => finish(new EdgeError("TIMEOUT", "the speech service stopped sending data")), IDLE_TIMEOUT_MS);
    };
    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(idle);
      signal.removeEventListener("abort", onAbort);
      ws.removeAllListeners();
      ws.on("error", () => {});
      ws.terminate();
      if (error) reject(error);
      else resolve({ audio: Buffer.concat(audio), words });
    };
    const onAbort = () => finish(new EdgeError(signal.reason instanceof EdgeError ? signal.reason.code : "ABORTED"));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    stillAlive();

    ws.on("unexpected-response", (_req, res) => {
      finish(new HandshakeRejected(res.statusCode ?? 0, res.headers.date));
    });
    ws.on("error", (e) => finish(new EdgeError("ENGINE_UNAVAILABLE", e.message)));
    ws.on("close", (code) => {
      // turn.end resolves first; closing without it means the stream was cut (worth a retry).
      finish(new EdgeError("ENGINE_UNAVAILABLE", `connection closed (${code}) before the end of the audio`));
    });
    ws.on("open", () => {
      const date = edgeDate();
      ws.send(
        `X-Timestamp:${date}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
          '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},' +
          '"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n',
      );
      // "Z" after a JavaScript date is not a mistake: it is what Microsoft Edge sends.
      ws.send(
        `X-RequestId:${randomUUID().replace(/-/g, "")}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${date}Z\r\nPath:ssml\r\n\r\n` +
          buildSsml(voiceId, rate, pitch, piece),
      );
    });
    ws.on("message", (raw: WebSocket.RawData, isBinary: boolean) => {
      stillAlive();
      try {
        const data = Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw);
        if (!isBinary) {
          const text = data.toString("utf8");
          const split = text.indexOf("\r\n\r\n");
          const path = parseHeaders(text.slice(0, split)).Path;
          if (path === "audio.metadata") words.push(...parseWordBoundaries(text.slice(split + 4)));
          else if (path === "turn.end") finish(null);
          return;
        }
        const { headers, payload } = parseBinaryFrame(data);
        if (headers.Path !== "audio") throw new Error(`unexpected binary path ${headers.Path}`);
        if (headers["Content-Type"] === "audio/mpeg" && payload.length) audio.push(payload);
      } catch (e) {
        finish(new EdgeError("ENGINE_UNAVAILABLE", (e as Error).message));
      }
    });
  });
}

const slots = new Semaphore(serverConfig.ttsMaxConcurrency);

/** Synthesizes text with a Microsoft Edge neural voice: MP3 bytes plus when each word is spoken. */
export async function synthesizeEdge(opts: { text: string; voice: string; rate: string; pitch: string; signal?: AbortSignal }): Promise<Speech> {
  const release = await slots.acquire(opts.signal).catch(() => {
    throw new EdgeError("ABORTED");
  });
  const timeout = AbortSignal.timeout(serverConfig.edgeTimeoutSec * 1000);
  const deadline = new AbortController();
  const onTimeout = () => deadline.abort(new EdgeError("TIMEOUT"));
  timeout.addEventListener("abort", onTimeout, { once: true });
  const signal = opts.signal ? AbortSignal.any([opts.signal, deadline.signal]) : deadline.signal;
  try {
    const parts: Buffer[] = [];
    const words: SpeechWord[] = [];
    let offset = 0;
    const add = (speech: Speech) => {
      parts.push(speech.audio);
      // Each piece's times start at 0; shift them by the audio before it.
      for (const w of speech.words) words.push({ text: w.text, start: offset + w.start, end: offset + w.end });
      offset += mp3DurationSeconds(speech.audio);
    };
    for (const piece of splitByBytes(escapeXml(removeIncompatibleCharacters(opts.text)))) {
      try {
        add(await synthesizePiece(piece, opts.voice, opts.rate, opts.pitch, signal));
      } catch (e) {
        // A 403 usually means our clock is off: follow the server's clock and retry once.
        if (!(e instanceof HandshakeRejected)) throw e;
        if (e.status !== 403 || !adjustClockSkew(e.date)) throw new EdgeError("ENGINE_UNAVAILABLE", e.message);
        try {
          add(await synthesizePiece(piece, opts.voice, opts.rate, opts.pitch, signal));
        } catch (retry) {
          throw retry instanceof HandshakeRejected ? new EdgeError("ENGINE_UNAVAILABLE", retry.message) : retry;
        }
      }
    }
    const audio = Buffer.concat(parts);
    if (audio.length < MIN_AUDIO_BYTES) throw new EdgeError("NO_AUDIO", `only ${audio.length} bytes of audio`);
    return { audio, words: words.sort((a, b) => a.start - b.start) };
  } finally {
    timeout.removeEventListener("abort", onTimeout);
    release();
  }
}

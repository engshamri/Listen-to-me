import { createHash } from "node:crypto";

/**
 * Connection token (Sec-MS-GEC) for Microsoft Edge's read-aloud speech service.
 *
 * Version 2 of the token is "<checksum>-<SHA-256>", both computed over
 * Microsoft's copyright line followed by the current five-minute window (in
 * Windows file-time ticks) and the public client token. The checksum constants
 * follow the published analysis credited in THIRD_PARTY_NOTICES.md.
 * tests/unit/edge.test.ts checks the output against the edge-tts Python package.
 */

export const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
export const CHROMIUM_FULL_VERSION = "143.0.3650.75";
export const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split(".")[0];
export const SEC_MS_GEC_VERSION = `2-${CHROMIUM_FULL_VERSION}`;

const EDGE_COPYRIGHT = "Copyright (C) Microsoft Corporation. All rights reserved.";
/** Seconds between 1601-01-01 (Windows file time) and 1970-01-01. */
const WIN_EPOCH = 11_644_473_600;

// Multipliers for the first and second 32-bit word of each 8-byte pair.
const TERM_MULTIPLIERS = [
  [0xef0569fb, 0x76f50f34, 0xc3efea97],
  [0xc31713db, 0x1881ce3c, 0x35bd1ec9],
] as const;
const MIX_MULTIPLIERS = [
  [0xcf98b111, 0x87085b9f, 0x12ceb96d, 0x257e1d83],
  [0xa27416f5, 0xd38396ff, 0x7c932b89, 0xbfa49f69],
] as const;

const swapHalves = (v: number) => ((v << 16) | (v >>> 16)) >>> 0;

function term(word: number, key: number, [wordMul, sumMul, productMul]: readonly number[]): number {
  const sum = (Math.imul(word, key) + Math.imul(swapHalves(word), wordMul)) >>> 0;
  const product = Math.imul(swapHalves(sum), sumMul) >>> 0;
  return (Math.imul(swapHalves(product), productMul) + product) >>> 0;
}

const mix = (value: number, multipliers: readonly number[]) => multipliers.reduce((v, m) => Math.imul(swapHalves(v), m) >>> 0, value);

/** 64-bit checksum over little-endian word pairs, keyed by the start of the SHA-256 digest. */
function checksum(message: Buffer, digest: Buffer): Buffer {
  const keys = [(digest.readUInt32LE(0) | 1) >>> 0, (digest.readUInt32LE(4) | 1) >>> 0];
  const padded = Buffer.alloc(Math.ceil(message.length / 8) * 8);
  message.copy(padded);
  let termSum = 0;
  let lastTerm = 0;
  let mixed = 0;
  let mixSum = 0;
  for (let at = 0; at < padded.length; at += 8) {
    for (const half of [0, 1]) {
      const word = padded.readUInt32LE(at + half * 4);
      lastTerm = term(word, keys[half], TERM_MULTIPLIERS[half]);
      termSum = (termSum + lastTerm) >>> 0;
      mixed = mix(Math.imul(mixed + word, keys[half]), MIX_MULTIPLIERS[half]);
      mixSum = (mixSum + mixed) >>> 0;
    }
  }
  const out = Buffer.alloc(8);
  out.writeUInt32LE((lastTerm ^ mixed) >>> 0, 0);
  out.writeUInt32LE((termSum ^ mixSum) >>> 0, 4);
  return out;
}

/** Token for the five-minute window containing `unixSeconds`: "<16 hex>-<64 hex>". */
export function secMsGecAt(unixSeconds: number): string {
  const windowStart = Math.floor((unixSeconds + WIN_EPOCH) / 300) * 300;
  const ticks = BigInt(windowStart) * 10_000_000n;
  const message = Buffer.from(`${EDGE_COPYRIGHT}${ticks}${TRUSTED_CLIENT_TOKEN}`, "ascii");
  const digest = createHash("sha256").update(message).digest();
  return `${checksum(message, digest).toString("hex")}-${digest.toString("hex")}`.toUpperCase();
}

// The service rejects tokens from the wrong window, so follow its clock if ours is off.
let clockSkewSeconds = 0;
let cached: { window: number; token: string } | null = null;

export function secMsGec(): string {
  const now = Date.now() / 1000 + clockSkewSeconds;
  const window = Math.floor((now + WIN_EPOCH) / 300);
  if (cached?.window !== window) cached = { window, token: secMsGecAt(now) };
  return cached.token;
}

/** After a 403, align with the server's Date header. Returns false when it cannot. */
export function adjustClockSkew(serverDate: string | undefined): boolean {
  const server = serverDate ? Date.parse(serverDate) : Number.NaN;
  if (!Number.isFinite(server)) return false;
  clockSkewSeconds += server / 1000 - (Date.now() / 1000 + clockSkewSeconds);
  cached = null;
  return true;
}

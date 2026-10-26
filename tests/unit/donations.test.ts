import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { keccak_256 } from "@noble/hashes/sha3.js";
import jsQR from "jsqr";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { DONATION_METHODS, qrDownloadPath, qrImagePath, type DonationMethodId } from "@/lib/donations";

const root = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const method = (id: DonationMethodId) => DONATION_METHODS.find((m) => m.id === id)!;

// The addresses the owner provided. Any change to the data file must be deliberate.
const USDT_TRC20 = "TLXRM9ZjDxtk6uEuMiKe3Ek8sHC8SQR845";
const XLAYER_OKX = "XKO63223abFd548A93b04975b217E2f007be0cf4CFA";
const XLAYER_0X = "0x63223abFd548A93b04975b217E2f007be0cf4CFA";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(s: string): Buffer {
  let n = 0n;
  for (const ch of s) {
    const i = BASE58.indexOf(ch);
    if (i < 0) throw new Error(`invalid base58 character ${ch}`);
    n = n * 58n + BigInt(i);
  }
  const hex = n.toString(16).padStart(50, "0");
  return Buffer.from(hex, "hex");
}

/** EIP-55: a hex letter is upper case when the matching nibble of keccak256(lowercase address) is >= 8. */
function eip55(address: string): string {
  const lower = address.slice(2).toLowerCase();
  const hash = Buffer.from(keccak_256(new TextEncoder().encode(lower))).toString("hex");
  return `0x${[...lower].map((c, i) => (/[a-f]/.test(c) && parseInt(hash[i], 16) >= 8 ? c.toUpperCase() : c)).join("")}`;
}

async function decodeQr(publicPath: string): Promise<string | null> {
  const { data, info } = await sharp(join(root, "public", publicPath), { density: 300 }).resize(800).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data ?? null;
}

describe("donation addresses", () => {
  it("are exactly the addresses provided by the owner", () => {
    expect(DONATION_METHODS.map((m) => m.id)).toEqual(["usdt-trc20", "btc-xlayer"]);
    expect(method("usdt-trc20").address).toBe(USDT_TRC20);
    expect(method("btc-xlayer").address).toBe(XLAYER_0X);
    expect(method("btc-xlayer").okxAddress).toBe(XLAYER_OKX);
  });

  it("USDT: a Tron mainnet address with a valid base58check checksum", () => {
    const raw = base58Decode(USDT_TRC20);
    expect(raw.length).toBe(25);
    expect(raw[0]).toBe(0x41); // Tron mainnet prefix
    const checksum = createHash("sha256").update(createHash("sha256").update(raw.subarray(0, 21)).digest()).digest().subarray(0, 4);
    expect(raw.subarray(21).equals(checksum)).toBe(true);
    // A single changed character must break the checksum.
    expect(() => {
      const bad = base58Decode(`${USDT_TRC20.slice(0, -1)}6`);
      const sum = createHash("sha256").update(createHash("sha256").update(bad.subarray(0, 21)).digest()).digest().subarray(0, 4);
      if (!bad.subarray(21).equals(sum)) throw new Error("checksum mismatch");
    }).toThrow();
  });

  it("X Layer: a 20-byte EVM address whose mixed case is a valid EIP-55 checksum", () => {
    expect(Buffer.from(keccak_256(new Uint8Array())).toString("hex")).toBe("c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
    expect(XLAYER_0X).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(eip55(XLAYER_0X)).toBe(XLAYER_0X);
    expect(eip55(XLAYER_0X.replace("abFd", "abfd"))).not.toBe(XLAYER_0X.replace("abFd", "abfd"));
  });

  it("the XKO and 0x forms are the same X Layer address", () => {
    expect(XLAYER_OKX.startsWith("XKO")).toBe(true);
    expect(`0x${XLAYER_OKX.slice(3)}`).toBe(XLAYER_0X);
  });

  it.each(DONATION_METHODS.map((m) => [m.id]))("%s: the page and download QR codes decode to exactly the address", async (id) => {
    const { address } = method(id as DonationMethodId);
    expect(await decodeQr(qrImagePath(id as DonationMethodId))).toBe(address);
    expect(await decodeQr(qrDownloadPath(id as DonationMethodId))).toBe(address);
  });

  it("documentation only mentions the verified addresses", () => {
    const known = new Set([USDT_TRC20, XLAYER_0X, XLAYER_OKX]);
    for (const file of ["README.md", "README-AR.md", "src/lib/i18n/messages/en.ts", "src/lib/i18n/messages/ar.ts"]) {
      const found = read(file).match(/\bT[1-9A-HJ-NP-Za-km-z]{33}\b|\b(?:0x|XKO)[0-9a-fA-F]{40}\b/g) ?? [];
      for (const address of found) expect(known.has(address), `${file}: ${address}`).toBe(true);
    }
  });
});

describe("GitHub FUNDING.yml", () => {
  it("only declares the custom link to the support page", () => {
    const yml = read(".github/FUNDING.yml");
    const lines = yml.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
    expect(lines).toEqual(["custom:", '  - "https://listen-to-me-shamri.vercel.app/support"']);
    expect(yml.endsWith("\n")).toBe(true);
  });
});

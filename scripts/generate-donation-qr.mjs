#!/usr/bin/env node
/**
 * Writes the QR codes for the /support page from src/data/donations.json:
 *   public/donate/<id>.svg                    shown on the page
 *   public/donate/listen-to-me-<id>-qr.png    the "Download QR code" file (1024 px)
 * Black on white with a 4-module quiet zone, so they scan in light and dark themes.
 * tests/unit/donations.test.ts decodes both files and compares them with the data.
 *
 *   node scripts/generate-donation-qr.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const methods = JSON.parse(readFileSync(join(root, "src/data/donations.json"), "utf8"));
const out = join(root, "public/donate");
mkdirSync(out, { recursive: true });

const options = { errorCorrectionLevel: "M", margin: 4, color: { dark: "#000000", light: "#ffffff" } };

for (const { id, address } of methods) {
  const svg = await QRCode.toString(address, { ...options, type: "svg" });
  writeFileSync(join(out, `${id}.svg`), svg);
  await QRCode.toFile(join(out, `listen-to-me-${id}-qr.png`), address, { ...options, type: "png", width: 1024 });
  console.log(`${id}: ${address}`);
}

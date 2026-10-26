// Generates the favicon, Apple touch icon, Open Graph image and the cover
// used for MP4 video export. Output files are committed; re-run after
// changing the brand:  node scripts/generate-brand-assets.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BRAND = "#0f766e";
const FONT = "Segoe UI, Inter, Arial, sans-serif";

/** Waveform mark inside a rounded tile, at any size. */
function mark(x, y, size, tile = BRAND, bars = "#ffffff") {
  const s = size / 32;
  const bar = (bx, by, h) => `<rect x="${x + bx * s}" y="${y + by * s}" width="${2.8 * s}" height="${h * s}" rx="${1.4 * s}" fill="${bars}"/>`;
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${9 * s}" fill="${tile}"/>${bar(7.5, 13, 6)}${bar(12.3, 8.5, 15)}${bar(17.1, 11, 10)}${bar(21.9, 14, 4)}`;
}

function waveform(x, y, width, height, color, count = 48, seed = 7) {
  let out = "";
  let r = seed;
  const gap = width / count;
  for (let i = 0; i < count; i++) {
    r = (r * 9301 + 49297) % 233280;
    const env = Math.sin((i / (count - 1)) * Math.PI);
    const h = Math.max(6, (0.25 + (r / 233280) * 0.75) * env * height);
    out += `<rect x="${(x + i * gap).toFixed(1)}" y="${(y + (height - h) / 2).toFixed(1)}" width="${(gap * 0.5).toFixed(1)}" height="${h.toFixed(1)}" rx="${(gap * 0.25).toFixed(1)}" fill="${color}"/>`;
  }
  return out;
}

const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${mark(0, 0, 32)}</svg>\n`;

const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#f6faf9"/>
  <rect x="0" y="0" width="1200" height="8" fill="${BRAND}"/>
  ${mark(96, 150, 120)}
  <text x="96" y="350" font-family="${FONT}" font-size="84" font-weight="700" fill="#0b1f1d">Listen to me</text>
  <text x="96" y="440" font-family="${FONT}" font-size="64" font-weight="600" fill="${BRAND}">اسمعني</text>
  <text x="96" y="520" font-family="${FONT}" font-size="34" fill="#3d524f">Free multilingual text to speech · 315 voices · 75 languages</text>
  ${waveform(760, 150, 360, 220, "#99d5cd")}
</svg>`;

const cover = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b2f2c"/>
      <stop offset="1" stop-color="#0b1020"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#bg)"/>
  ${waveform(240, 380, 800, 180, "#2dd4bf", 64, 11)}
  ${mark(588, 120, 104, "#5eead4", "#042f2e")}
  <text x="640" y="300" font-family="${FONT}" font-size="56" font-weight="700" fill="#e6f4f1" text-anchor="middle">Listen to me · اسمعني</text>
</svg>`;

async function png(svg, file, width, height) {
  mkdirSync(dirname(file), { recursive: true });
  await sharp(Buffer.from(svg)).resize(width, height).png({ compressionLevel: 9 }).toFile(file);
  console.log("wrote", file.replace(root, "."));
}

writeFileSync(join(root, "src/app/icon.svg"), icon);
console.log("wrote ./src/app/icon.svg");
await png(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${BRAND}"/>${mark(4, 4, 24)}</svg>`, join(root, "src/app/apple-icon.png"), 180, 180);
await png(og, join(root, "src/app/opengraph-image.png"), 1200, 630);
await png(cover, join(root, "public/brand/video-cover.png"), 1280, 720);

// Copies browser-side engine files from node_modules into /public so the app
// serves them from its own origin (no third-party CDN, works offline):
//   - pdf.js (PDF text extraction): the worker of the *legacy* build, which
//     carries polyfills for older browsers (Safari before 26.2 fails with the
//     modern build), named after its version so a cached worker never pairs
//     with another library version; character maps (text of CJK PDFs),
//     standard fonts and image decoders (JBIG2/JPEG 2000 scans, for OCR)
//   - the tesseract.js worker, its WebAssembly cores and the Arabic/English
//     language data (OCR for scanned PDFs)
// Runs automatically on install, dev and build. Files that are already
// identical are left alone, so timestamps don't trigger rebuilds.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nm = (...p) => join(root, "node_modules", ...p);
const pub = (...p) => join(root, "public", ...p);

/** LSTM-only builds: tesseract.js picks relaxed-SIMD, SIMD or plain at runtime. */
const OCR_CORES = ["tesseract-core-relaxedsimd-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-lstm.wasm.js"];
export const OCR_LANGS = ["ara", "eng"];

const pdfjsVersion = existsSync(nm("pdfjs-dist", "package.json")) ? JSON.parse(readFileSync(nm("pdfjs-dist", "package.json"), "utf8")).version : null;
/** Every file of a pdfjs-dist data folder (licences included). */
const pdfjsFolder = (folder, keep = () => true) =>
  existsSync(nm("pdfjs-dist", folder)) ? readdirSync(nm("pdfjs-dist", folder)).filter(keep).map((f) => [nm("pdfjs-dist", folder, f), pub("pdfjs", folder, f)]) : [];

const files = [
  ...(pdfjsVersion ? [[nm("pdfjs-dist", "legacy", "build", "pdf.worker.min.mjs"), pub("pdfjs", `pdf.worker-${pdfjsVersion}.min.mjs`)]] : []),
  ...pdfjsFolder("cmaps"),
  ...pdfjsFolder("standard_fonts"),
  // Not the JavaScript sandbox (quickjs): scripting stays off.
  ...pdfjsFolder("wasm", (f) => !f.startsWith("quickjs")),
  [nm("tesseract.js", "dist", "worker.min.js"), pub("ocr", "worker.min.js")],
  ...OCR_CORES.map((f) => [nm("tesseract.js-core", f), pub("ocr", "core", f)]),
  ...OCR_LANGS.map((l) => [nm("@tesseract.js-data", l, "4.0.0_best_int", `${l}.traineddata.gz`), pub("ocr", "lang", `${l}.traineddata.gz`)]),
];

function same(a, b) {
  if (!existsSync(b) || statSync(a).size !== statSync(b).size) return false;
  return readFileSync(a).equals(readFileSync(b));
}

let copied = 0;
let missing = 0;
for (const [src, dest] of files) {
  if (!existsSync(src)) {
    missing++;
    continue;
  }
  if (same(src, dest)) continue;
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  copied++;
}
if (missing) console.warn(`[vendor-assets] ${missing} source file(s) not installed yet; run npm install.`);
if (copied) console.log(`[vendor-assets] copied ${copied} file(s) to public/`);

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";

/** Generated PDF fixtures (not committed), printed by the browser like real exported documents. */
export const GENERATED_DIR = join(__dirname, "..", "fixtures", "generated");
/** 450 pages; page N says «الصفحة N». */
export const ARABIC_BOOK = join(GENERATED_DIR, "arabic-book-450.pdf");
export const ARABIC_BOOK_PAGES = 450;
/** A 15-page English technical report (about 0.9 MB) with commands, port tables and a screenshot-like image on every page; page N's heading is "Finding N". */
export const REPORT_15 = join(GENERATED_DIR, "security-report-15.pdf");

async function print(page: Page, body: string, css: string, file: string) {
  await page.setContent(`<html><head><meta charset="utf-8"><style>body{font-family:'Segoe UI',Arial,sans-serif} section{page-break-after:always} ${css}</style></head><body>${body}</body></html>`);
  // Let scripts (the canvas images) run before printing.
  await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready !== false);
  writeFileSync(file, await page.pdf({ format: "A4" }));
}

export default async function globalSetup() {
  if (existsSync(ARABIC_BOOK) && existsSync(REPORT_15)) return;
  mkdirSync(GENERATED_DIR, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
  const page = await browser.newPage();
  if (!existsSync(ARABIC_BOOK)) {
    const pages = Array.from(
      { length: ARABIC_BOOK_PAGES },
      (_, i) =>
        `<section><h2>Chapter ${i + 1}</h2><p dir="rtl">الصفحة ${i + 1}: تتأثر سرعة التفاعل الإنزيمي بدرجة الحرارة ودرجة الحموضة وتركيز المادة المتفاعلة. وتعمل الإنزيمات على خفض طاقة التنشيط اللازمة لبدء التفاعل الكيميائي في الخلايا الحية.</p></section>`,
    ).join("");
    await print(page, pages, "body{font-size:18px}", ARABIC_BOOK);
  }
  if (!existsSync(REPORT_15)) {
    const sections = Array.from(
      { length: 15 },
      (_, i) => `<section><h2>Finding ${i + 1}: Service exposure on host 192.168.56.${10 + i}</h2>
<p>The scan <code>nmap -sS -sV -O -p- 192.168.56.${10 + i}</code> reported the open ports below. Each service was checked against the vendor's advisories for Windows 7 SP1.</p>
<table border="1" cellpadding="4"><tr><th>PORT</th><th>STATE</th><th>SERVICE</th><th>VERSION</th></tr>
<tr><td>135/tcp</td><td>open</td><td>msrpc</td><td>Microsoft Windows RPC</td></tr>
<tr><td>139/tcp</td><td>open</td><td>netbios-ssn</td><td>Microsoft Windows netbios-ssn</td></tr>
<tr><td>445/tcp</td><td>open</td><td>microsoft-ds</td><td>Windows 7 Professional 7601 Service Pack 1</td></tr></table>
<p>Recommendation ${i + 1}: disable SMBv1, apply MS17-010 and restrict RPC to the management network.</p>
<canvas class="shot" width="1600" height="1250"></canvas></section>`,
    ).join("");
    // Screenshot-like images that compress poorly, so the file has real weight.
    const script = `<script>window.ready=false;for(const c of document.querySelectorAll('canvas.shot')){const x=c.getContext('2d');const d=x.createImageData(c.width,c.height);let s=7;for(let i=0;i<d.data.length;i+=4){s=(s*1103515245+12345)>>>0;const v=s>>>24;d.data[i]=v;d.data[i+1]=(v*3)&255;d.data[i+2]=(v*7)&255;d.data[i+3]=255}x.putImageData(d,0,0)}window.ready=true;</script>`;
    await print(page, sections + script, "body{font-size:14px} canvas{width:12cm}", REPORT_15);
  }
  await browser.close();
}

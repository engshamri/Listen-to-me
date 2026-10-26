import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

/** Generated PDF fixtures (not committed): see tests/e2e/fixtures.ts. */
export const GENERATED_DIR = join(__dirname, "..", "fixtures", "generated");
export const ARABIC_BOOK = join(GENERATED_DIR, "arabic-book-450.pdf");
export const ARABIC_BOOK_PAGES = 450;

/**
 * A 450-page Arabic book with an English heading on each page, printed by the
 * browser (like a real exported document): page N says «الصفحة N».
 */
export default async function globalSetup() {
  if (existsSync(ARABIC_BOOK)) return;
  mkdirSync(GENERATED_DIR, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
  const page = await browser.newPage();
  const pages = Array.from(
    { length: ARABIC_BOOK_PAGES },
    (_, i) =>
      `<section><h2>Chapter ${i + 1}</h2><p dir="rtl">الصفحة ${i + 1}: تتأثر سرعة التفاعل الإنزيمي بدرجة الحرارة ودرجة الحموضة وتركيز المادة المتفاعلة. وتعمل الإنزيمات على خفض طاقة التنشيط اللازمة لبدء التفاعل الكيميائي في الخلايا الحية.</p></section>`,
  ).join("");
  await page.setContent(
    `<html><head><meta charset="utf-8"><style>body{font-family:'Segoe UI',Arial,sans-serif;font-size:18px} section{page-break-after:always}</style></head><body>${pages}</body></html>`,
  );
  writeFileSync(ARABIC_BOOK, await page.pdf({ format: "A4" }));
  await browser.close();
}

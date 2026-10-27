import { readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type FileChooser, type Page } from "@playwright/test";
import { ARABIC_BOOK, ARABIC_BOOK_PAGES, REPORT_15 } from "./global-setup";
import { editor, noHorizontalOverflow, openFresh } from "./helpers";

/*
 * PDF and TXT import through the Upload button and the browser's file
 * chooser, in desktop Edge and in WebKit with an iPhone 13 profile.
 * Fixtures: the 5-page lecture (page 3 Arabic, page 4 scanned), the same
 * lecture protected with the password "study123" and owner-restricted
 * (scripts/make-protected-pdfs.py), and a 450-page Arabic book printed by the
 * browser in global-setup.ts.
 */

const FIXTURES = join(__dirname, "..", "fixtures");
const LECTURE = join(FIXTURES, "lecture-enzymes.pdf");
const PROTECTED = join(FIXTURES, "lecture-password.pdf");
/** Encrypted with an owner password only: opens without one (like many published books). */
const RESTRICTED = join(FIXTURES, "lecture-restricted.pdf");
const lectureBytes = () => readFileSync(LECTURE);

const dialog = (page: Page) => page.getByRole("dialog", { name: /Import PDF|استيراد ملف PDF/ });

/** Clicks the Upload tool and answers the file chooser it opens. */
async function choose(page: Page, files: Parameters<FileChooser["setFiles"]>[0], label = "Upload") {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: label, exact: true }).click()]);
  expect(chooser.isMultiple()).toBe(false);
  await chooser.setFiles(files);
}

async function openArabic(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.context().clearCookies();
  await page.context().addCookies([{ name: "locale", value: "ar", url: "http://127.0.0.1" }]);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
}

/** Records requests to any other host (the PDF must never leave the device). */
function watchExternal(page: Page): string[] {
  const external: string[] = [];
  page.context().on("request", (r) => {
    const url = new URL(r.url());
    if (/^(https?|wss?):$/.test(url.protocol) && url.host !== "127.0.0.1:3210" && !url.host.startsWith("127.0.0.1")) external.push(r.url());
  });
  return external;
}

/** Built-ins and APIs pdf.js uses, by the Safari version that added them. */
const BUILT_INS = {
  /** ReadableStream async iteration: Safari 27 (WebKit 26.5 in Playwright). pdf.js's getTextContent() needs it. */
  "safari-27": `[ReadableStream.prototype,Symbol.asyncIterator],[ReadableStream.prototype,"values"]`,
  /** Safari 26.2 (Chrome 145/147, Firefox 137/144). */
  "safari-26.2": `[Map.prototype,"getOrInsertComputed"],[Map.prototype,"getOrInsert"],[WeakMap.prototype,"getOrInsertComputed"],[WeakMap.prototype,"getOrInsert"],[Math,"sumPrecise"]`,
  /** Safari 18.2. */
  "safari-18.2": `[Uint8Array.prototype,"toHex"],[Uint8Array.prototype,"toBase64"],[Uint8Array,"fromHex"],[Uint8Array,"fromBase64"],[Promise,"try"]`,
};

/**
 * Makes the page behave like an older Safari: what it lacks is removed in the
 * page and in the pdf.js worker before any code runs. "26.0-26.4" is what
 * the real iPhone failure needed: the document opened, then reading text
 * threw "undefined is not a function" (ReadableStream async iteration).
 * Real older engines are tested by scripts/old-webkit-check.mjs.
 */
async function simulateOlderBrowser(page: Page, safari: "26.0-26.4" | "18.2-26.1" | "before-18.2") {
  const list =
    safari === "26.0-26.4"
      ? BUILT_INS["safari-27"]
      : safari === "18.2-26.1"
        ? `${BUILT_INS["safari-27"]},${BUILT_INS["safari-26.2"]}`
        : `${BUILT_INS["safari-27"]},${BUILT_INS["safari-26.2"]},${BUILT_INS["safari-18.2"]}`;
  const strip = `for (const [o, k] of [${list}]) { try { delete o[k]; } catch {} }`;
  await page.addInitScript(strip);
  await page.route(/\/pdfjs\/pdf\.worker-[\d.]+\.min\.mjs$/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${strip}\n${await response.text()}` });
  });
}

test("a real PDF: every page read, the scanned page offered for OCR, text in the editor, nothing sent off the device", async ({ page }) => {
  await openFresh(page);
  const external = watchExternal(page);
  await choose(page, LECTURE);
  await expect(dialog(page).getByTestId("pdf-file-name")).toHaveText("lecture-enzymes.pdf");
  await expect(dialog(page).getByText("5 pages", { exact: false }).first()).toBeVisible();
  await expect(dialog(page).getByText("5 pages selected: 1-5")).toBeVisible();
  await dialog(page).getByRole("button", { name: "Extract text" }).click();
  await expect(dialog(page).getByText(/Page 4 has no selectable text/)).toBeVisible();
  await dialog(page).getByRole("button", { name: "Import without it" }).click();
  await expect(dialog(page)).toBeHidden();
  const text = await editor(page).inputValue();
  expect(text).toContain("Lecture 3: Enzymes and Metabolism");
  expect(text).toContain("Michaelis");
  expect(text).toContain("الإنزيمات بروتينات تسرّع التفاعلات");
  expect(text).toContain("Summary");
  expect(external).toEqual([]);
});

test("page range with two number fields: exactly pages 2 to 3; numbers use the number keypad, several ranges a text keyboard", async ({ page }) => {
  await openFresh(page);
  await choose(page, LECTURE);
  await dialog(page).getByRole("radio", { name: "Page range" }).check();
  const from = dialog(page).getByLabel("From page");
  const to = dialog(page).getByLabel("To page");
  await expect(from).toHaveAttribute("inputmode", "numeric");
  await from.fill("2");
  await to.fill("3");
  await expect(dialog(page).getByText("2 pages selected: 2-3")).toBeVisible();

  // The field for several ranges must offer hyphens and commas on iPhone: a text keyboard.
  await dialog(page).getByRole("radio", { name: "Several pages or ranges" }).check();
  const several = dialog(page).getByLabel("Pages and ranges");
  await expect(several).toHaveAttribute("type", "text");
  await expect(several).toHaveAttribute("inputmode", "text");
  await several.fill("1-5,8");
  await expect(dialog(page).getByText("“8” goes past the end: this document ends at page 5.")).toBeVisible();

  await dialog(page).getByRole("radio", { name: "Page range" }).check();
  await expect(from).toHaveValue("2");
  await dialog(page).getByRole("button", { name: "Extract text" }).click();
  await expect(dialog(page)).toBeHidden();
  const text = await editor(page).inputValue();
  expect(text).toContain("Michaelis");
  expect(text).toContain("الإنزيمات في الجسم");
  expect(text).not.toContain("Lecture 3: Enzymes and Metabolism");
  expect(text).not.toContain("Summary");
  await expect(page.getByText("pages 2-3 of 5")).toBeVisible();

  // A single page.
  await choose(page, LECTURE);
  await dialog(page).getByRole("radio", { name: "Single page" }).check();
  await dialog(page).getByLabel("Page", { exact: true }).fill("5");
  await dialog(page).getByRole("button", { name: "Extract text" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(editor(page)).toHaveValue(/^Summary/);
});

test("Arabic interface: several ranges with Arabic digits and the Arabic comma; invalid ranges are explained and nothing is imported", async ({ page }) => {
  await openArabic(page);
  await choose(page, LECTURE, "رفع ملف");
  const d = dialog(page);
  await d.getByRole("radio", { name: "نطاقات متعددة" }).check();
  const field = d.getByLabel("الصفحات والنطاقات");
  await expect(field).toHaveAttribute("dir", "ltr");

  await field.fill("٥-٢");
  await expect(d.getByText("في «5-2» الصفحة الأولى بعد الأخيرة. اكتب الرقم الأصغر أولاً.")).toBeVisible();
  await d.getByRole("button", { name: "استخراج النص" }).click();
  await expect(d.getByRole("alert")).toContainText("الصفحة الأولى بعد الأخيرة");
  await expect(page.locator("#editor")).toHaveValue("");

  await field.fill("١،٣");
  await expect(d.getByText(/حُدِّدت صفحتان: .*1، 3/)).toBeVisible();
  await d.getByRole("button", { name: "استخراج النص" }).click();
  await expect(d).toBeHidden();
  const text = await page.locator("#editor").inputValue();
  expect(text).toContain("Lecture 3: Enzymes and Metabolism");
  expect(text).toContain("الإنزيمات في الجسم");
  expect(text).not.toContain("Michaelis");
});

test("password-protected PDF: the password is asked for, a wrong one is explained, the right one opens it", async ({ page }) => {
  await openFresh(page);
  await choose(page, PROTECTED);
  const d = dialog(page);
  await expect(d.getByText(/This PDF is protected with a password/)).toBeVisible();
  await d.getByLabel("Password").fill("wrong");
  await d.getByRole("button", { name: "Open", exact: true }).click();
  await expect(d.getByRole("alert")).toHaveText(/That password isn't right/);
  await d.getByLabel("Password").fill("study123");
  await d.getByRole("button", { name: "Open", exact: true }).click();
  await d.getByRole("radio", { name: "Single page" }).check();
  await d.getByLabel("Page", { exact: true }).fill("1");
  await d.getByRole("button", { name: "Extract text" }).click();
  await expect(d).toBeHidden();
  await expect(editor(page)).toHaveValue(/^Lecture 3: Enzymes and Metabolism/);
});

test("damaged and unsupported files get their own messages; the picker can be used again at once", async ({ page }) => {
  await openFresh(page);
  await choose(page, { name: "broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\nthis is not a pdf at all\n%%EOF") });
  await expect(dialog(page).getByRole("alert")).toHaveText(/This file is damaged: its structure can't be read as a PDF/);
  await expect(dialog(page).getByRole("button", { name: "Try again" })).toBeVisible();
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await expect(dialog(page)).toBeHidden();

  await choose(page, { name: "essay.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("PK\u0003\u0004 not text") });
  await expect(page.getByText("This file type isn't supported. Choose a PDF or a TXT (plain text) file.")).toBeVisible();

  await choose(page, { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Plain notes after an error.") });
  await expect(editor(page)).toHaveValue("Plain notes after an error.");
});

test("files are recognized from their bytes: uppercase extensions, empty or generic types, no extension; the same file twice; a cancelled picker changes nothing", async ({ page }) => {
  await openFresh(page);
  // A cancelled choice (no file) leaves everything as it was.
  await choose(page, []);
  await expect(dialog(page)).toBeHidden();
  await expect(editor(page)).toHaveValue("");

  await choose(page, { name: "NOTES.TXT", mimeType: "", buffer: Buffer.from("Uppercase name, no type.") });
  await expect(editor(page)).toHaveValue("Uppercase name, no type.");
  await choose(page, { name: "download", mimeType: "application/octet-stream", buffer: Buffer.from("A text file without an extension.") });
  await expect(editor(page)).toHaveValue("A text file without an extension.");

  for (const [name, mimeType] of [
    ["LECTURE.PDF", ""],
    ["lecture.pdf", "application/octet-stream"],
    ["document", "application/octet-stream"],
  ]) {
    await choose(page, { name, mimeType, buffer: lectureBytes() });
    await expect(dialog(page).getByTestId("pdf-file-name")).toHaveText(name);
    await expect(dialog(page).getByText("5 pages selected: 1-5")).toBeVisible();
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page)).toBeHidden();
  }

  // The same file twice in a row: the second choice is imported too.
  const same = { name: "same.txt", mimeType: "text/plain", buffer: Buffer.from("Same file.") };
  await choose(page, same);
  await expect(editor(page)).toHaveValue("Same file.");
  await editor(page).fill("Edited in between.");
  await choose(page, same);
  await expect(editor(page)).toHaveValue("Same file.");
});

for (const safari of ["26.0-26.4", "18.2-26.1", "before-18.2"] as const) {
  test(`older browsers (like Safari ${safari}) read the text of PDFs, including owner-restricted ones`, async ({ page }) => {
    await simulateOlderBrowser(page, safari);
    await openFresh(page);
    expect(await page.evaluate(() => typeof (ReadableStream.prototype as unknown as Record<symbol, unknown>)[Symbol.asyncIterator])).toBe("undefined");
    for (const file of [RESTRICTED, LECTURE]) {
      await choose(page, file);
      await dialog(page).getByRole("radio", { name: "Single page" }).check();
      await dialog(page).getByLabel("Page", { exact: true }).fill("2");
      await dialog(page).getByRole("button", { name: "Extract text" }).click();
      await expect(dialog(page)).toBeHidden();
      await expect(editor(page)).toHaveValue(/Michaelis/);
      await editor(page).fill("");
    }
  });
}

test("a 450-page Arabic book: pages 440 to 445 exactly, then the whole book with progress", async ({ page }) => {
  test.setTimeout(300_000);
  await openFresh(page);
  await choose(page, ARABIC_BOOK);
  const d = dialog(page);
  await expect(d.getByText(`${ARABIC_BOOK_PAGES} pages`).first()).toBeVisible({ timeout: 60_000 });
  await d.getByRole("radio", { name: "Page range" }).check();
  await d.getByLabel("From page").fill("440");
  await d.getByLabel("To page").fill("445");
  await d.getByRole("button", { name: "Extract text" }).click();
  await expect(d).toBeHidden({ timeout: 60_000 });
  const text = await editor(page).inputValue();
  for (let n = 440; n <= 445; n++) expect(text).toContain(`الصفحة ${n}:`);
  expect(text).not.toContain("الصفحة 439:");
  expect(text).not.toContain("الصفحة 446:");
  expect(text).not.toMatch(/[یکھ]/u);

  await choose(page, ARABIC_BOOK);
  await expect(d.getByText(`${ARABIC_BOOK_PAGES} pages selected: 1-${ARABIC_BOOK_PAGES}`)).toBeVisible({ timeout: 60_000 });
  await d.getByRole("button", { name: "Extract text" }).click();
  await expect(d.getByRole("progressbar")).toBeVisible();
  await expect(d).toBeHidden({ timeout: 240_000 });
  const all = await editor(page).inputValue();
  expect(all).toContain("الصفحة 1:");
  expect(all).toContain(`الصفحة ${ARABIC_BOOK_PAGES}:`);
  expect(all.indexOf("الصفحة 99:")).toBeLessThan(all.indexOf("الصفحة 100:"));
});

test("the import dialog stays on screen: very long file name, narrow and landscape screens, no zoom on focus, actions reachable", async ({ page, isMobile }) => {
  await openFresh(page);
  const longName = `Lecture_03_Enzymes_and_Metabolism_Biochemistry_Department_Final_Revised_Version_${"x".repeat(60)}.pdf`;
  await choose(page, { name: longName, mimeType: "application/pdf", buffer: lectureBytes() });
  const d = dialog(page);
  await d.getByRole("radio", { name: "Page range" }).check();
  await d.getByLabel("From page").focus();

  const check = async (label: string) => {
    const m = await d.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, scrollW: el.scrollWidth, clientW: el.clientWidth, vw: window.innerWidth, vh: window.innerHeight };
    });
    expect(m.scrollW, `${label}: no sideways scrolling inside the dialog`).toBeLessThanOrEqual(m.clientW + 1);
    expect(m.left, label).toBeGreaterThanOrEqual(0);
    expect(m.right, label).toBeLessThanOrEqual(m.vw);
    expect(m.top, label).toBeGreaterThanOrEqual(0);
    expect(m.bottom, label).toBeLessThanOrEqual(m.vh);
    // The file name wraps inside the dialog instead of widening it.
    const name = await d.getByTestId("pdf-file-name").boundingBox();
    expect(name!.x + name!.width, label).toBeLessThanOrEqual(m.right);
    // Both actions can be reached (scrolled into view inside the dialog).
    for (const button of ["Cancel", "Extract text"]) {
      await d.getByRole("button", { name: button }).scrollIntoViewIfNeeded();
      await expect(d.getByRole("button", { name: button }), `${label}: ${button}`).toBeInViewport();
    }
    await noHorizontalOverflow(page);
  };
  await check("portrait");
  if (isMobile) {
    // iOS zooms the page when a field under 16px gets focus.
    for (const field of [d.getByLabel("From page"), d.getByLabel("To page")]) {
      expect(parseFloat(await field.evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    }
    const size = page.viewportSize()!;
    await page.setViewportSize({ width: size.height, height: size.width });
    await check("landscape");
    await page.setViewportSize({ width: 320, height: 568 });
    await check("small phone");
  }
});

test("no accessibility violations in the import dialog (English, Arabic, password step)", async ({ page }) => {
  const scan = async (label: string) => {
    // After the dialog's fade-in: half-transparent text would fail contrast while it animates.
    await dialog(page).evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
    const r = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), label).toEqual([]);
  };
  await openFresh(page);
  await choose(page, LECTURE);
  await dialog(page).getByRole("radio", { name: "Page range" }).check();
  await page.waitForTimeout(300);
  await scan("page selection");
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await choose(page, PROTECTED);
  await expect(dialog(page).getByLabel("Password")).toBeVisible();
  await scan("password");
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await openArabic(page);
  await choose(page, LECTURE, "رفع ملف");
  await dialog(page).getByRole("radio", { name: "نطاقات متعددة" }).check();
  await page.waitForTimeout(300);
  await scan("Arabic, several ranges");
});

test("PDF check page: every stage passes on the sample in a browser like Safari 26.0; your own file shows counts only", async ({ page }) => {
  await simulateOlderBrowser(page, "26.0-26.4");
  await page.goto("/pdf-check");
  await expect(page.getByText("All steps passed: this browser can read PDFs here.")).toBeVisible({ timeout: 60_000 });
  for (const id of ["reader", "open", "page1", "page5", "reopen", "cleanup"]) await expect(page.getByTestId(`pdf-check-${id}`)).toHaveAttribute("data-status", "ok");
  await expect(page.getByTestId("pdf-check-page1")).toContainText("Lecture 3: Enzymes and Metabolism");
  await expect(page.getByTestId("pdf-check-reopen")).toContainText("Michaelis");

  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Choose a PDF" }).click()]);
  await chooser.setFiles(RESTRICTED);
  const own = page.getByTestId("pdf-check-own-result");
  await expect(own).toContainText("5 pages");
  await expect(own).toContainText(/Page 1: \d+ characters read/);
  await expect(own).not.toContainText("Enzymes");

  await page.getByText("Show the diagnostic report").click();
  const report = await page.getByRole("textbox", { name: "Diagnostic report" }).inputValue();
  expect(report).toContain("Result: all PDF check steps passed");
  expect(report).toContain("NO   ReadableStream async iteration");
  expect(report).toMatch(/Own file: 0\.\d+ MB, 5 pages; page 1: \d+ characters/);
  expect(report).not.toContain("lecture-restricted");
});

test("when the PDF reader can't start, the dialog says why and offers a diagnostic report without the file name", async ({ page, browserName, context }) => {
  await page.route(/\/pdfjs\/pdf\.worker-[\d.]+\.min\.mjs$/, (route) => route.fulfill({ status: 404, body: "missing" }));
  await openFresh(page);
  await choose(page, LECTURE);
  await expect(dialog(page).getByRole("alert")).toHaveText(/The PDF reader didn't load/);
  await expect(dialog(page).getByRole("link", { name: "Test this browser (PDF check)" })).toHaveAttribute("href", "/pdf-check");
  await dialog(page).getByText("Show the diagnostic report").click();
  const report = await dialog(page).getByRole("textbox", { name: "Diagnostic report" }).inputValue();
  expect(report).toContain('Result: READER_FAILED at stage "open"');
  expect(report).toMatch(/Error: .*fake worker/);
  expect(report).toContain("pdf.js: 6.");
  expect(report).toContain("(name not included)");
  expect(report).not.toContain("lecture-enzymes");
  if (browserName === "chromium") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await dialog(page).getByRole("button", { name: "Copy diagnostic report" }).click();
    await expect(page.getByText("Diagnostic report copied.", { exact: false })).toBeVisible();
    // The Windows clipboard turns line breaks into CRLF.
    expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n")).toBe(report);
  }
});

test("no accessibility violations on the PDF check page (English and Arabic)", async ({ page }) => {
  const scan = async (label: string) => {
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), label).toEqual([]);
  };
  await page.goto("/pdf-check");
  await expect(page.getByText("All steps passed")).toBeVisible({ timeout: 60_000 });
  await scan("English");
  await page.context().addCookies([{ name: "locale", value: "ar", url: "http://127.0.0.1" }]);
  await page.goto("/pdf-check");
  await expect(page.getByText("نجحت كل الخطوات")).toBeVisible({ timeout: 60_000 });
  await scan("Arabic");
});

test("a 15-page technical report with images (like the PDF that failed on a real iPhone): all pages, then one page, in a browser like Safari 26.0", async ({ page }) => {
  await simulateOlderBrowser(page, "26.0-26.4");
  await openFresh(page);
  await choose(page, REPORT_15);
  const d = dialog(page);
  await expect(d.getByText("15 pages selected: 1-15")).toBeVisible();
  await d.getByRole("button", { name: "Extract text" }).click();
  await expect(d).toBeHidden({ timeout: 60_000 });
  const all = await editor(page).inputValue();
  for (const n of [1, 8, 15]) expect(all).toContain(`Finding ${n}: Service exposure on host 192.168.56.${10 + n - 1}`);
  expect(all).toContain("nmap -sS -sV -O -p-");
  expect(all).toContain("445/tcp");

  await choose(page, REPORT_15);
  await d.getByRole("radio", { name: "Single page" }).check();
  await d.getByLabel("Page", { exact: true }).fill("7");
  await d.getByRole("button", { name: "Extract text" }).click();
  await expect(d).toBeHidden();
  const one = await editor(page).inputValue();
  expect(one).toContain("Finding 7:");
  expect(one).not.toContain("Finding 6:");
  expect(one).not.toContain("Finding 8:");
});
